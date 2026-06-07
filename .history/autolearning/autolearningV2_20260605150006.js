const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");


const accounts = [
 { email: "052089015493", password: "052089015493" },
  { email: "052088019344", password: "052088019344" },
  { email: "052098000426", password: "052098000426" },
  { email: "052186003347", password: "052186003347" },
  { email: "042078014759", password: "042078014759" },
  { email: "051198000386", password: "051198000386" },
  { email: "051095014689", password: "051095014689" },
  { email: "049095008152", password: "049095008152" },
  { email: "051200006469", password: "051200006469" },
  { email: "051094010015", password: "051094010015" },
  { email: "052208004808", password: "052208004808" },
  { email: "052201005693", password: "052201005693" },
  { email: "052200000899", password: "052200000899" },
  { email: "052098000451", password: "052098000451" },
  { email: "052205016254", password: "052205016254" },
  { email: "052195005218", password: "052195005218" },
  { email: "052190021046", password: "052190021046" },
  { email: "052189008919", password: "052189008919" },
  { email: "052196009371", password: "052196009371" },
  { email: "052186014829", password: "052186014829" },
  { email: "051073009548", password: "051073009548" },
  { email: "051096014557", password: "051096014557" },
 
];

const browserSessions = {};

const sleep = (ms) => {
  return new Promise((rs) => setTimeout(rs, ms));
};

// Serialize ghi file để tránh race-condition khi nhiều account hoàn thành cùng lúc
let fileWriteLock = Promise.resolve();
async function removeCompletedAccount(email) {
  fileWriteLock = fileWriteLock.then(async () => {
    try {
      const filePath = __filename;
      const content = await fs.promises.readFile(filePath, "utf8");
      // Khớp đúng dòng: { email: "<cccd>", password: "<cccd>" },
      const lineRegex = new RegExp(
        `^[ \\t]*\\{[ \\t]*email:[ \\t]*"${email}",[ \\t]*password:[ \\t]*"${email}"[ \\t]*\\},?[ \\t]*\\r?\\n`,
        "m"
      );
      const newContent = content.replace(lineRegex, "");
      if (newContent !== content) {
        await fs.promises.writeFile(filePath, newContent, "utf8");
        console.log(`🗑️ Đã xoá CCCD ${email} khỏi danh sách accounts (đã hoàn thành toàn bộ).`);
      } else {
        console.warn(`⚠️ Không tìm thấy dòng CCCD ${email} để xoá.`);
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

        // Học một môn ngẫu nhiên từ danh sách
        const randomSubjectLink = linkSubject[0];
        console.log(`Đang học môn: ${randomSubjectLink}`);

        const lessons = await fetchLessons(
          randomSubjectLink,
          sessionCookie.value,
          randomSubjectLink
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
        } else {
          console.log(
            `Môn học ${randomSubjectLink} không có bài học nào chưa hoàn thành. Chuyển sang môn khác.`
          );
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
