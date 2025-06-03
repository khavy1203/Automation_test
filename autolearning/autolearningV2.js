const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

const accounts = [
  { email: "052193002098", password: "052193002098" },
  { email: "052191020175", password: "052191020175" },
  { email: "052185002573", password: "052185002573" },
  { email: "052201002630", password: "052201002630" },
  { email: "056097003396", password: "056097003396" },
  { email: "052088014742", password: "052088014742" },
];

// Đối tượng để lưu trữ các trình duyệt
const browserSessions = {};

const sleep = (ms) => {
  return new Promise((rs) => setTimeout(rs, ms));
};

async function loginAccount(account) {
  let browser;
  try {
    // Khởi tạo trình duyệt mới
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Tăng timeout lên 60 giây (hoặc tùy chỉnh)
    console.log(`Đang tải trang cho ${account.email}...`);
    await page.goto("https://hoclythuyetlaixe.eco-tek.com.vn/web/login", {
      waitUntil: "networkidle2",
      timeout: 360000, // 60 giây
    });

    // Điền email
    await page.type('input[name="login"]', account.email, { delay: 100 });

    // Điền password
    await page.type('input[name="password"]', account.password, { delay: 100 });

    // Nhấn nút đăng nhập và đợi điều hướng xong
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 360000 }),
      page.click('button[type="submit"]'),
    ]);

    // 👉 Lấy cookie sau login
    const cookies = await page.browserContext().cookies();
    const sessionCookie = cookies.find(
      (cookie) => cookie.name === "session_id"
    );

    if (sessionCookie) {
      const userInfo = await fetchUserInfo(sessionCookie.value);
      console.log(`📋 Thông tin người dùng cho ${account.email}:`, userInfo);
      //ví dụ
      // {
      //   "id": 53935,
      //   "name": "NGUYỄN THỊ BÍCH DIỆU",
      //   "email": "052192015152",
      //   "active": true,
      //   "im_status": "offline",
      //   "user": { "id": 53164, "isInternalUser": true },
      //   "out_of_office_date_end": false
      // }
      console.log("check userInfo", userInfo);

      // const listSlideCompleted = await fetchCompletedSlides(sessionCookie.value, userInfo);
      // console.log('check listSlideCompleted', listSlideCompleted)

      console.log(`🍪 session_id: ${sessionCookie.value}`);
      const linkSubject = await fetchCourseLinks(sessionCookie.value);
      console.log("check linkSubject", linkSubject);

      // Lấy bài học từ từng môn học
      for (const link of linkSubject) {
        const lessons = await fetchLessons(link, sessionCookie.value, link);

        // Mở trình duyệt và lấy API cho từng bài học
        for (const lesson of lessons) {
          const timeLearned = await fetchGetTimeLearned(sessionCookie.value);
          const totalHours = timeLearned.hours + timeLearned.minutes / 60;
          console.log("⏰ Tổng thời gian học (giờ):", totalHours.toFixed(2));

          if (totalHours < 7.75) {
            console.log("check time đã vô timeLearned", timeLearned);
            await fetchLessonAPIs(
              lesson.link,
              sessionCookie.value,
              page,
              browser
            );
          } else {
            console.log("check đã thoát với time và totalHours", timeLearned);
            await browser.close();
            return;
          }
        }
      }
    } else {
      console.warn("⚠️ Không tìm thấy session_id!");
    }

    if (sessionCookie) {
      console.log(`🍪 session_id: ${sessionCookie.value}`);
    } else {
      console.warn("⚠️ Không tìm thấy session_id!");
    }
  } catch (error) {
    console.error(`Lỗi khi đăng nhập ${account.email}:`, error.message);
    if (browser) await browser.close(); // Đóng trình duyệt nếu lỗi
    throw error; // Ném lỗi để xử lý ở cấp cao hơn nếu cần
  }
}

// Hàm lấy trình duyệt
function getBrowser(email) {
  return browserSessions[email] || null;
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
          priority: "u=1, i",
          referer: "https://hoclythuyetlaixe.eco-tek.com.vn/web",
          "sec-ch-ua":
            '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
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
    if (data.result && data.result.current_partner) {
      console.log("📋 Thông tin người dùng:", data.result.current_partner);
      return data.result.current_partner;
    } else {
      console.warn("⚠️ Không tìm thấy thông tin người dùng trong response");
      return null;
    }
  } catch (error) {
    console.error("❌ Lỗi khi lấy thông tin người dùng:", error.message);
    return null;
  }
}

// Hàm lấy danh sách môn học chưa hoàn thành
async function fetchCourseLinks(session_id) {
  try {
    // Kiểm tra session_id
    if (!session_id) {
      throw new Error("session_id is required");
    }

    const res = await fetch("https://hoclythuyetlaixe.eco-tek.com.vn/slides", {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        Connection: "keep-alive",
        Referer: "https://hoclythuyetlaixe.eco-tek.com.vn/web/login",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "sec-ch-ua":
          '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        Cookie: `session_id=${session_id}; frontend_lang=vi_VN; cids=73; tz=Asia/Saigon`,
      },
    });

    // Kiểm tra trạng thái HTTP
    if (!res.ok) {
      throw new Error(`HTTP error! Status: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();

    // Kiểm tra xem cheerio có được import hay không
    if (typeof cheerio === "undefined") {
      throw new Error("Cheerio is not defined. Please ensure it is imported.");
    }

    const $ = cheerio.load(html);

    // Kiểm tra xem có phần tử khóa học nào không
    const courseCards = $("div.o_wslides_course_card");
    if (courseCards.length === 0) {
      console.warn("⚠️ Không tìm thấy khóa học nào trong HTML.");
      return [];
    }

    const courseLinks = [];
    courseCards.each((_, el) => {
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
    throw error; // Ném lỗi để hàm gọi có thể xử lý
  }
}

// Hàm lấy danh sách môn học chưa hoàn thành
async function fetchGetTimeLearned(session_id) {
  try {
    // Kiểm tra session_id
    if (!session_id) {
      throw new Error("session_id is required");
    }

    const res = await fetch("https://hoclythuyetlaixe.eco-tek.com.vn/slides", {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        Connection: "keep-alive",
        Referer: "https://hoclythuyetlaixe.eco-tek.com.vn/web/login",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "sec-ch-ua":
          '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        Cookie: `session_id=${session_id}; frontend_lang=vi_VN; cids=73; tz=Asia/Saigon`,
      },
    });

    // Kiểm tra trạng thái HTTP
    if (!res.ok) {
      throw new Error(`HTTP error! Status: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();

    // Kiểm tra xem cheerio có được import hay không
    if (typeof cheerio === "undefined") {
      throw new Error("Cheerio is not defined. Please ensure it is imported.");
    }

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
    throw error; // Ném lỗi để hàm gọi có thể xử lý
  }
}

// Hàm lấy danh sách bài học có tiến độ hoàn thành nhỏ hơn 100% từ một khóa học
async function fetchLessons(slideUrl, session_id, subject) {
  try {
    // Kiểm tra tham số đầu vào
    if (!session_id) {
      throw new Error("session_id is required");
    }
    if (!slideUrl) {
      throw new Error("slideUrl is required");
    }

    const res = await fetch(
      `https://hoclythuyetlaixe.eco-tek.com.vn${slideUrl}`,
      {
        method: "GET",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
          Connection: "keep-alive",
          Referer: "https://hoclythuyetlaixe.eco-tek.com.vn/slides",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          "sec-ch-ua":
            '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          Cookie: `session_id=${session_id}; frontend_lang=vi_VN; cids=73; tz=Asia/Saigon`,
        },
      }
    );

    // Kiểm tra trạng thái HTTP
    if (!res.ok) {
      throw new Error(`HTTP error! Status: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();

    // Kiểm tra xem cheerio có được import hay không
    if (typeof cheerio === "undefined") {
      throw new Error("Cheerio is not defined. Please ensure it is imported.");
    }

    const $ = cheerio.load(html);

    // Kiểm tra xem có bài học nào không
    const lessonItems = $(
      "li.o_wslides_slides_list_slide.o_wslides_js_list_item"
    );
    if (lessonItems.length === 0) {
      console.warn(`⚠️ Không tìm thấy bài học nào trong HTML tại ${slideUrl}`);
      return [];
    }

    const lessons = [];
    lessonItems.each((_, el) => {
      const linkElement = $(el).find("a.o_wslides_js_slides_list_slide_link");
      const icon = $(el).find("i").attr("class") || "";
      const title = linkElement.text().trim();
      const href = linkElement.attr("href");
      const slideId = $(el).attr("data-slide-id");
      const completion = $(el).find("span.badge.text-bg-primary").text().trim();

      // Chuyển chuỗi completion thành số (loại bỏ "%" và khoảng trắng)
      const completionValue = parseFloat(completion.replace(/[^0-9.]/g, ""));

      // Chỉ lấy bài học có tiến độ hoàn thành < 100% và không phải chứng chỉ (fa-trophy)
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
    throw error; // Ném lỗi để hàm gọi có thể xử lý
  }
}

// Hàm mở trình duyệt và lắng nghe API của bài học
async function fetchLessonAPIs(lessonUrl, session_id, page, browser) {
  try {
    // Mảng lưu trữ thông tin API
    const apiRequests = [];
    let countdownEndReceived = false;

    // Promise để chờ API countdown-end hoặc timeout
    const waitForCountdownEnd = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`⏰ Timeout chờ API countdown-end cho ${lessonUrl}`);
        resolve();
      }, 6000000 * 2); // Timeout sau 5 phút

      page.on("request", async (request) => {
        const resourceType = request.resourceType();
        const url = request.url();

        // Ghi lại các request API
        if (
          ["xhr", "fetch"].includes(resourceType) ||
          url.includes("/api/") ||
          url.includes("json")
        ) {
          const apiData = {
            url: url,
            method: request.method(),
            headers: request.headers(),
            resourceType: resourceType,
          };
          apiRequests.push(apiData);

          if (
            url ===
            "https://hoclythuyetlaixe.eco-tek.com.vn/slide/countdown-end/"
          ) {
            console.log(`🎉 Nhận được API countdown-end cho ${lessonUrl}`);
            countdownEndReceived = true;
            clearTimeout(timeout);
            resolve({
              finished: true,
            });
          }
        }
      });

      // Lắng nghe response để lấy dữ liệu
      page.on("response", async (response) => {
        const request = response.request();
        const url = response.url();
        if (
          ["xhr", "fetch"].includes(request.resourceType()) ||
          url.includes("/api/") ||
          url.includes("json")
        ) {
          try {
            const responseData = await response.json().catch(() => null);
            const apiEntry = apiRequests.find((req) => req.url === url);
            if (apiEntry) {
              apiEntry.status = response.status();
              apiEntry.responseData = responseData;
            }
          } catch (error) {
            console.warn(`⚠️ Không thể parse JSON từ ${url}:`, error.message);
          }
        }
      });
    });

    // Truy cập trang bài học
    console.log(`Đang mở trình duyệt cho bài học: ${lessonUrl}`);
    await page.goto(
      `https://hoclythuyetlaixe.eco-tek.com.vn/${lessonUrl}?fullscreen=0`,
      {
        waitUntil: "networkidle2",
        timeout: 60000,
      }
    );

    // Chờ API countdown-end hoặc timeout
    return await waitForCountdownEnd;
  } catch (error) {
    console.error(`❌ Lỗi khi lấy API từ ${lessonUrl}:`, error.message);
    await browser.close();
    return [];
  }
}

// Hàm chạy tất cả tài khoản đồng thời
async function runAllLogins() {
  console.log("Bắt đầu đăng nhập tất cả tài khoản...");
  try {
    // Chạy đăng nhập cho tất cả tài khoản đồng thời
    const loginPromises = accounts.map((account) =>
      loginAccount(account)
        .then(() => console.log(`✅ Đăng nhập thành công cho ${account.email}`))
        .catch((error) =>
          console.error(`❌ Lỗi đăng nhập cho ${account.email}:`, error.message)
        )
    );

    // Chờ tất cả Promise hoàn tất
    await Promise.all(loginPromises);

    console.log("Hoàn tất đăng nhập tất cả tài khoản!");
    console.log("Các phiên trình duyệt đang mở:", Object.keys(browserSessions));
  } catch (error) {
    console.error("❌ Lỗi khi chạy tất cả tài khoản:", error.message);
  }
}

// Chạy chương trình
async function main() {
  await runAllLogins();
}
main().catch((err) => console.error("Lỗi chính:", err));
