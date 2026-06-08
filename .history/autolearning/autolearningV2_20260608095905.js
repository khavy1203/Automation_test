const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");


// File text chứa danh sách account (mỗi dòng 1 CCCD). Đặt cạnh file code này.
const ACCOUNTS_FILE = path.join(__dirname, "accounts.txt");

const browserSessions = {};

const sleep = (ms) => {
  return new Promise((rs) => setTimeout(rs, ms));
};

// Đọc danh sách account từ accounts.txt. Mỗi dòng là 1 số CCCD.
// Bỏ qua dòng trống và dòng chú thích bắt đầu bằng '#'.
// Đọc lại mỗi lần chạy nên thêm/bớt account trong file là app tự cập nhật.
async function loadAccounts() {
  try {
    const content = await fs.promises.readFile(ACCOUNTS_FILE, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((cccd) => ({ email: cccd, password: cccd }));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(`❌ Không tìm thấy file danh sách account: ${ACCOUNTS_FILE}`);
    } else {
      console.error("❌ Lỗi khi đọc file danh sách account:", err.message);
    }
    return [];
  }
}

// Serialize ghi file để tránh race-condition khi nhiều account hoàn thành cùng lúc
let fileWriteLock = Promise.resolve();
async function removeCompletedAccount(email) {
  fileWriteLock = fileWriteLock.then(async () => {
    try {
      const content = await fs.promises.readFile(ACCOUNTS_FILE, "utf8");
      const lines = content.split(/\r?\n/);
      // Xoá đúng dòng chứa CCCD này (so khớp sau khi trim, giữ lại comment/dòng khác)
      const newLines = lines.filter((line) => line.trim() !== email);
      if (newLines.length !== lines.length) {
        await fs.promises.writeFile(ACCOUNTS_FILE, newLines.join("\n"), "utf8");
        console.log(`🗑️ Đã xoá CCCD ${email} khỏi accounts.txt (đã hoàn thành toàn bộ).`);
      } else {
        console.warn(`⚠️ Không tìm thấy CCCD ${email} trong accounts.txt để xoá.`);
      }
    } catch (err) {
      console.error(`❌ Lỗi khi xoá CCCD ${email} khỏi file:`, err.message);
    }
  });
  return fileWriteLock;
}

async function loginAccount(account) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      userDataDir: `E:/TTSHLX_CODE/Automation/.chrome-profiles/${account.email}`,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    const page = await browser.newPage();

    console.log(`Đang tải trang cho ${account.email}...`);
    await page.goto("https://hoclythuyetlaixe.eco-tek.com.vn/web/login", {
      waitUntil: "networkidle2",
      timeout: 3600000,
    });

    await page.type('input[name="login"]', account.email, { delay: 100 });
    await page.type('input[name="password"]', account.password, { delay: 100 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 360000 }),
      page.click('button[type="submit"]'),
    ]);

    const cookies = await page.browserContext().cookies();
    const sessionCookie = cookies.find(
      (cookie) => cookie.name === "session_id"
    );

    if (sessionCookie) {
      const userInfo = await fetchUserInfo(sessionCookie.value);
      console.log(`📋 Thông tin người dùng cho ${account.email}:`, userInfo);

      console.log(`🍪 session_id: ${sessionCookie.value}`);

      function shuffleArray(array) {
        return array
          .map((item) => ({ item, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .map(({ item }) => item);
      }

      // Vòng lặp chính để học
      while (true) {
        const linkSubject = await fetchCourseLinks(sessionCookie.value);
        console.log("check linkSubject", linkSubject);

        // Kiểm tra nếu không còn môn nào chưa hoàn thành thì thoát
        if (linkSubject.length === 0) {
          console.log("🎉 Tất cả các môn học đã hoàn thành. Thoát.");
          await removeCompletedAccount(account.email);
          break;
        }

        const timeLearned = await fetchGetTimeLearned(sessionCookie.value);
        const totalHours = timeLearned.hours + timeLearned.minutes / 60;
        console.log("⏰ Tổng thời gian học (giờ):", totalHours.toFixed(2));

        if (totalHours >= 7.75) {
          console.log("check đã thoát với time và totalHours", timeLearned);
          break;
        }

        // Duyệt qua các môn để tìm môn THỰC SỰ còn bài học chưa hoàn thành.
        // (Một số môn như "mô phỏng" tuy hiển thị chưa hoàn thành nhưng
        //  không có bài học dạng chuẩn -> fetchLessons trả về [], phải bỏ qua
        //  để tránh kẹt vòng lặp vô hạn ở môn đầu tiên.)
        let didLearn = false;
        for (const subjectLink of linkSubject) {
          console.log(`Đang kiểm tra môn: ${subjectLink}`);

          const lessons = await fetchLessons(
            subjectLink,
            sessionCookie.value,
            subjectLink
          );
          const shuffledLessons = shuffleArray(lessons);

          if (shuffledLessons.length > 0) {
            const lesson = shuffledLessons[0];
            console.log(`Đang học bài: ${lesson.title}`);
            await fetchLessonAPIs(
              lesson.link,
              sessionCookie.value,
              page,
              browser
            );
            didLearn = true;
            break; // Học xong 1 bài thì quay lại đầu vòng để cập nhật tiến độ
          } else {
            console.log(
              `Môn học ${subjectLink} không có bài học nào chưa hoàn thành. Chuyển sang môn khác.`
            );
          }
        }

        // Nếu duyệt hết tất cả các môn mà không môn nào còn bài học để học
        // -> không thể tiến thêm được nữa, thoát để tránh lặp vô hạn.
        if (!didLearn) {
          console.log(
            "⚠️ Không còn bài học nào có thể học (các môn còn lại như mô phỏng không có bài học chuẩn). Thoát tài khoản này."
          );
          break;
        }
      }
    } else {
      console.warn("⚠️ Không tìm thấy session_id!");
    }
  } catch (error) {
    console.error(`Lỗi khi đăng nhập ${account.email}:`, error.message);
    if (browser) await browser.close();
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

// Hàm lấy thông tin người dùng
async function fetchUserInfo(session_id) {
  try {
    const res = await fetch(
      "https://hoclythuyetlaixe.eco-tek.com.vn/mail/init_messaging",
      {
        method: "POST",
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          origin: "https://lms.eco-tek.com.vn",
          referer: "https://hoclythuyetlaixe.eco-tek.com.vn/web",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          Cookie: `session_id=${session_id}; frontend_lang=en_US; tz=Asia/Saigon`,
        },
        body: JSON.stringify({
          id: 0,
          jsonrpc: "2.0",
          method: "call",
          params: {},
        }),
      }
    );
    const data = await res.json();
    return data.result.current_partner;
  } catch (error) {
    console.error("❌ Lỗi khi lấy thông tin người dùng:", error.message);
    return null;
  }
}

// Hàm lấy danh sách môn học chưa hoàn thành
async function fetchCourseLinks(session_id) {
  try {
    if (!session_id) throw new Error("session_id is required");
    const res = await fetch("https://hoclythuyetlaixe.eco-tek.com.vn/slides", {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        Cookie: `session_id=${session_id}; frontend_lang=vi_VN; cids=73; tz=Asia/Saigon`,
      },
    });

    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const courseLinks = [];
    $("div.o_wslides_course_card").each((_, el) => {
      const linkElement = $(el).find('a[href^="/slides/"]');
      const href = linkElement.attr("href");
      const isCompleted =
        $(el).find("span.badge.rounded-pill.text-bg-success").length > 0;
      if (
        href &&
        !isCompleted &&
        !courseLinks.includes(href) &&
        !href.startsWith("/slides/all")
      ) {
        courseLinks.push(href);
      }
    });

    console.log("📚 Link các môn học chưa hoàn thành:", courseLinks);
    return courseLinks;
  } catch (error) {
    console.error("❌ Lỗi khi fetch dữ liệu:", error.message);
    throw error;
  }
}

// Hàm lấy thời gian đã học
async function fetchGetTimeLearned(session_id) {
  try {
    if (!session_id) throw new Error("session_id is required");
    const res = await fetch("https://hoclythuyetlaixe.eco-tek.com.vn/slides", {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Cookie: `session_id=${session_id}; frontend_lang=vi_VN; cids=73; tz=Asia/Saigon`,
      },
    });

    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    let timeLearned = { hours: 0, minutes: 0 };
    const studyTimeElement = $(
      'a.nav-link.nav-link.d-flex:contains("Thời lượng đã học hôm nay")'
    );
    if (studyTimeElement.length > 0) {
      const studyTimeText = studyTimeElement.text().trim();
      const match = studyTimeText.match(/(\d+)\s*giờ\s*(\d+)\s*phút/);
      if (match) {
        timeLearned.hours = parseInt(match[1], 10);
        timeLearned.minutes = parseInt(match[2], 10);
      }
    }
    return timeLearned;
  } catch (error) {
    console.error("❌ Lỗi khi fetch dữ liệu:", error.message);
    throw error;
  }
}

// Hàm lấy danh sách bài học chưa hoàn thành
async function fetchLessons(slideUrl, session_id, subject) {
  try {
    if (!session_id || !slideUrl)
      throw new Error("session_id and slideUrl are required");
    const res = await fetch(
      `https://hoclythuyetlaixe.eco-tek.com.vn${slideUrl}`,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          Cookie: `session_id=${session_id}; frontend_lang=vi_VN; cids=73; tz=Asia/Saigon`,
        },
      }
    );

    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const lessons = [];
    $("li.o_wslides_slides_list_slide.o_wslides_js_list_item").each((_, el) => {
      const linkElement = $(el).find("a.o_wslides_js_slides_list_slide_link");
      const icon = $(el).find("i").attr("class") || "";
      const title = linkElement.text().trim();
      const href = linkElement.attr("href");
      const slideId = $(el).attr("data-slide-id");
      const completion = $(el).find("span.badge.text-bg-primary").text().trim();
      const completionValue = parseFloat(completion.replace(/[^0-9.]/g, ""));

      if (
        href &&
        title &&
        !isNaN(completionValue) &&
        completionValue < 100 &&
        !icon.includes("fa-trophy")
      ) {
        lessons.push({
          title,
          link: href,
          slide_id: slideId,
          subject,
          completion: completionValue,
        });
      }
    });

    console.log(
      `📚 Danh sách bài học có tiến độ hoàn thành nhỏ hơn 100% từ ${slideUrl}:`,
      lessons
    );
    return lessons;
  } catch (error) {
    console.error(`❌ Lỗi khi lấy bài học từ ${slideUrl}:`, error.message);
    throw error;
  }
}

// Hàm mở trình duyệt và lắng nghe API của bài học
async function fetchLessonAPIs(lessonUrl, session_id, page, browser) {
  try {
    const apiRequests = [];
    const waitForCountdownEnd = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`⏰ Timeout chờ API countdown-end cho ${lessonUrl}`);
        resolve({ finished: false });
      }, 6000000);

      page.on("request", async (request) => {
        const url = request.url();
        if (
          url === "https://hoclythuyetlaixe.eco-tek.com.vn/slide/countdown-end/"
        ) {
          console.log(`🎉 Nhận được API countdown-end cho ${lessonUrl}`);
          clearTimeout(timeout);
          resolve({ finished: true });
        }
      });
    });

    console.log(`Đang mở trình duyệt cho bài học: ${lessonUrl}`);
    await page.goto(
      `https://hoclythuyetlaixe.eco-tek.com.vn/${lessonUrl}?fullscreen=0`,
      {
        waitUntil: "networkidle2",
        timeout: 60000,
      }
    );

    return await waitForCountdownEnd;
  } catch (error) {
    console.error(`❌ Lỗi khi lấy API từ ${lessonUrl}:`, error.message);
    throw error;
  }
}

async function runAllLogins() {
  console.log("Bắt đầu đăng nhập tất cả tài khoản...");
  const accounts = await loadAccounts();
  if (accounts.length === 0) {
    console.warn(
      "⚠️ Không có account nào trong accounts.txt. Hãy thêm CCCD vào file rồi chạy lại."
    );
    return;
  }
  console.log(`📋 Đã nạp ${accounts.length} account từ accounts.txt`);
  try {
    const loginPromises = accounts.map(async (account, index) => {
      await sleep(index * 5 * 60000);
      await loginAccount(account)
        .then(() => console.log(`✅ Đăng nhập thành công cho ${account.email}`))
        .catch((error) =>
          console.error(`❌ Lỗi đăng nhập cho ${account.email}:`, error.message)
        );
    });
    await Promise.all(loginPromises);
    console.log("Hoàn tất đăng nhập tất cả tài khoản!");
    console.log("Các phiên trình duyệt đang mở:", Object.keys(browserSessions));
  } catch (error) {
    console.error("❌ Lỗi khi chạy tất cả tài khoản:", error.message);
  }
}

async function main() {
  await runAllLogins();
}

main().catch((err) => console.error("Lỗi chính:", err));
