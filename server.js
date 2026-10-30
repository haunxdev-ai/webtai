/**
 * Nhật Minh Express – Máy chủ web + trang quản trị
 * Chạy:  node server.js   (hoặc bấm đúp start.bat / start.command)
 *        cần Node.js 16 trở lên, không cần cài thêm thư viện
 *
 * - Website:   http://localhost:3000/
 * - Quản trị:  http://localhost:3000/admin
 *   Lần đầu mở /admin: tự tạo tên đăng nhập + mật khẩu ngay trên trang.
 *
 * Khi tạo / xóa bài viết, server tự ghi lại vùng "Tin tức" trong index.html
 * (giữa hai dòng <!-- POSTS:START --> và <!-- POSTS:END -->) và tạo trang
 * chi tiết tại bai-viet/<slug>.html.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(ROOT, "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const INDEX_FILE = path.join(ROOT, "index.html");
const POST_DIR = path.join(ROOT, "bai-viet");
const HOME_LIMIT = 3; // số bài hiển thị ở trang chủ
const SESSION_TTL = 8 * 60 * 60 * 1000;

/* ===== CẤU HÌNH THEO DỰ ÁN (sửa ở đây nếu tên/đường dẫn khác) =====
 * Cấu trúc thư mục mong đợi (server.js nằm CÙNG CẤP với index.html và assets/):
 *   index.html
 *   server.js
 *   assets/
 *     css/  reset.css, grid.css, style.css, responsive.css
 *     img/  ...ảnh, logo...
 */
// Các file CSS gắn vào trang chi tiết bài viết – GIỮ ĐÚNG THỨ TỰ như trong index.html
const CSS_FILES = [
    "assets/css/reset.css",
    "assets/css/grid.css",
    "assets/css/style.css",
    "assets/css/responsive.css",
];
// Logo hiển thị ở đầu trang bài viết. Đổi tên cho đúng file logo của bạn.
// Nếu file không tồn tại, trang bài viết sẽ hiện chữ thay cho logo.
const LOGO_FILE = "assets/img/logo.png";

const CATEGORIES = [
    "Tin tức Nhật Minh Express",
    "Tin tức gửi hàng đi nước Mỹ",
    "Tin tức gửi hàng đi nước Canada",
    "Tin tức gửi hàng đi nước Úc",
    "Tin tức gửi hàng đi các nước Châu Âu",
    "Tin tức gửi hàng đi Hàn Quốc",
];

/* ---------- Tiện ích ---------- */
const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );

function writeAtomic(file, content) {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
}
function readJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}
const readPosts = () => readJSON(POSTS_FILE, []);
const savePosts = (posts) =>
    writeAtomic(POSTS_FILE, JSON.stringify(posts, null, 2));

function slugify(str) {
    return (
        str
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/đ/g, "d")
            .replace(/Đ/g, "D")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "bai-viet"
    );
}
function fmtDate(iso) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "numeric",
    }).formatToParts(new Date(iso));
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get("day")} Th${get("month")}`;
}
function fmtFull(iso) {
    return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "long",
        timeStyle: "short",
    }).format(new Date(iso));
}
const safeImage = (u) => (/^(https?:\/\/|\/)[^\s"'<>]+$/.test(u) ? u : "");

/* ---------- Mật khẩu ---------- */
function hashPw(pw, salt = crypto.randomBytes(16).toString("hex")) {
    return { salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") };
}
function checkPw(pw, rec) {
    const a = crypto.scryptSync(pw, rec.salt, 64);
    const b = Buffer.from(rec.hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Khởi tạo dữ liệu ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(POST_DIR, { recursive: true });
if (!fs.existsSync(POSTS_FILE)) savePosts([]);
// Tài khoản quản trị do BẠN TỰ TẠO: lần đầu mở /admin sẽ hiện form tạo tài khoản.
// (Tùy chọn: đặt sẵn bằng biến môi trường ADMIN_USER + ADMIN_PASS khi chạy lần đầu.)
if (
    !fs.existsSync(ADMIN_FILE) &&
    process.env.ADMIN_USER &&
    process.env.ADMIN_PASS
) {
    writeAtomic(
        ADMIN_FILE,
        JSON.stringify(
            {
                username: process.env.ADMIN_USER,
                ...hashPw(process.env.ADMIN_PASS),
            },
            null,
            2,
        ),
    );
}
const hasAdmin = () => fs.existsSync(ADMIN_FILE);
const validUsername = (u) => /^[A-Za-z0-9._@-]{3,32}$/.test(u);
const MIN_PW = 8;

/* ---------- Đồng bộ index.html ---------- */
function renderCard(p) {
    const img =
        p.imageUrl && safeImage(p.imageUrl)
            ? `<img class="post-img" src="${esc(p.imageUrl)}" alt="${esc(p.title)}" loading="lazy">`
            : `<div class="placeholder post-img">ẢNH</div>`;
    return `          <article class="post">
            ${img}
            <small>${esc(p.category)} · ${fmtDate(p.createdAt)}</small>
            <h3><a href="bai-viet/${esc(p.slug)}.html">${esc(p.title)}</a></h3>
            ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}
          </article>`;
}
function syncIndex() {
    const latest = readPosts()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, HOME_LIMIT);
    const html = fs.readFileSync(INDEX_FILE, "utf8");
    const re = /(<!-- POSTS:START -->)[\s\S]*?(<!-- POSTS:END -->)/;
    if (!re.test(html))
        throw new Error(
            "index.html thiếu dòng <!-- POSTS:START --> / <!-- POSTS:END -->",
        );
    const cards = latest.length
        ? latest.map(renderCard).join("\n")
        : "          <p>Chưa có bài viết.</p>";
    writeAtomic(
        INDEX_FILE,
        html.replace(re, (_, a, b) => `${a}\n${cards}\n          ${b}`),
    );
}

function renderPostPage(p) {
    const cssLinks = CSS_FILES.map(
        (f) => `<link rel="stylesheet" href="../${esc(f)}">`,
    ).join("\n  ");
    const logoHtml =
        LOGO_FILE && fs.existsSync(path.join(ROOT, LOGO_FILE))
            ? `<a href="../index.html"><img class="logo" src="../${esc(LOGO_FILE)}" alt="Nhật Minh Express" style="object-fit:contain"></a>`
            : `<a href="../index.html"><strong>Nhật Minh Express</strong></a>`;
    const body = String(p.content)
        .split(/\n{2,}/)
        .map((para) => `<p>${esc(para.trim()).replace(/\n/g, "<br>")}</p>`)
        .join("\n");
    const img =
        p.imageUrl && safeImage(p.imageUrl)
            ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" style="width:100%;border-radius:10px;margin:16px 0">`
            : "";
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(p.title)} – Nhật Minh Express</title>
  <meta name="description" content="${esc(p.excerpt || p.title)}">
  ${cssLinks}
  <style>.article{max-width:800px;margin:40px auto}.article h1{color:var(--primary);font-size:1.9rem;font-weight:700;line-height:1.3;margin:6px 0 12px}.article p{margin:14px 0;line-height:1.7}</style>
</head>
<body>
  <header class="site-header"><div class="container header-inner">${logoHtml}<a href="../index.html">← Về trang chủ</a></div></header>
  <main class="container"><article class="article">
    <small>${esc(p.category)} · ${esc(fmtFull(p.createdAt))}</small>
    <h1>${esc(p.title)}</h1>
    ${img}
    ${body}
  </article></main>
</body>
</html>
`;
}

/* ---------- Phiên đăng nhập ---------- */
const sessions = new Map();
const loginFails = new Map(); // ip -> {count, until}

function parseCookies(req) {
    const out = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
        const i = c.indexOf("=");
        if (i > 0)
            out[c.slice(0, i).trim()] = decodeURIComponent(
                c.slice(i + 1).trim(),
            );
    });
    return out;
}
function getSession(req) {
    const sid = parseCookies(req).sid;
    const s = sid && sessions.get(sid);
    if (!s) return null;
    if (s.expires < Date.now()) {
        sessions.delete(sid);
        return null;
    }
    return s;
}

/* ---------- HTTP ---------- */
function send(res, status, body, headers = {}) {
    res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        ...headers,
    });
    res.end(body);
}
const redirect = (res, to, headers = {}) => {
    res.writeHead(303, { Location: to, ...headers });
    res.end();
};

function readBody(req, limit = 300 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error("Dữ liệu quá lớn"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () =>
            resolve(
                new URLSearchParams(Buffer.concat(chunks).toString("utf8")),
            ),
        );
        req.on("error", reject);
    });
}

const STYLE = `
*{box-sizing:border-box}body{font-family:"Segoe UI",Roboto,Arial,sans-serif;background:#f4f6fa;color:#222;margin:0;line-height:1.5}
.wrap{max-width:900px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border:1px solid #e3e7ee;border-radius:10px;padding:20px;margin-bottom:20px}
h1,h2{margin:0 0 12px;color:#0b3d91}label{display:block;font-weight:600;margin:12px 0 4px}
input,select,textarea{width:100%;padding:10px;border:1px solid #cfd6e2;border-radius:8px;font:inherit}
textarea{min-height:220px;resize:vertical}
button,.btn{background:#e8590c;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
button.ghost{background:#6b7585}button.danger{background:#c92a2a;padding:6px 12px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:8px;flex-wrap:wrap}
.msg{padding:10px 14px;border-radius:8px;margin-bottom:16px}.ok{background:#d3f9d8}.err{background:#ffe3e3}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #e3e7ee;vertical-align:middle}
small{color:#777}form.inline{display:inline}`;

const page = (title, body) =>
    `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><div class="wrap">${body}</div></body></html>`;

const ADMIN_HEADERS = {
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
};

function loginPage(msg = "") {
    return page(
        "Đăng nhập quản trị",
        `<div class="card" style="max-width:400px;margin:60px auto">
    <h1>Đăng nhập quản trị</h1>${msg ? `<div class="msg err">${esc(msg)}</div>` : ""}
    <form method="post" action="/admin/login">
      <label>Tên đăng nhập</label><input name="username" autocomplete="username" required autofocus>
      <label>Mật khẩu</label><input name="password" type="password" autocomplete="current-password" required>
      <p><button>Đăng nhập</button></p>
    </form></div>`,
    );
}

function setupPage(msg = "") {
    return page(
        "Tạo tài khoản quản trị",
        `<div class="card" style="max-width:420px;margin:60px auto">
    <h1>Tạo tài khoản quản trị</h1>
    <p><small>Đây là lần đầu sử dụng. Hãy tự đặt tên đăng nhập và mật khẩu cho trang quản trị.</small></p>
    ${msg ? `<div class="msg err">${esc(msg)}</div>` : ""}
    <form method="post" action="/admin/setup">
      <label>Tên đăng nhập (3–32 ký tự: chữ, số, . _ @ -)</label>
      <input name="username" autocomplete="username" required autofocus minlength="3" maxlength="32">
      <label>Mật khẩu (tối thiểu ${MIN_PW} ký tự)</label>
      <input name="password" type="password" autocomplete="new-password" required minlength="${MIN_PW}">
      <label>Nhập lại mật khẩu</label>
      <input name="password2" type="password" autocomplete="new-password" required minlength="${MIN_PW}">
      <p><button>Tạo tài khoản</button></p>
    </form></div>`,
    );
}

function dashboardPage(user, flash) {
    const posts = readPosts().sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
    );
    const rows = posts
        .map(
            (p) => `<tr>
      <td><a href="/bai-viet/${esc(p.slug)}.html" target="_blank">${esc(p.title)}</a><br><small>${esc(p.category)}</small></td>
      <td><small>${esc(fmtFull(p.createdAt))}</small></td>
      <td><form class="inline" method="post" action="/admin/posts/delete" onsubmit="return confirm('Xóa bài này?')">
        <input type="hidden" name="id" value="${esc(p.id)}"><button class="danger">Xóa</button></form></td>
    </tr>`,
        )
        .join("");
    return page(
        "Quản trị bài viết",
        `
    <div class="top"><h1>Quản trị bài viết</h1>
      <div>Xin chào, <b>${esc(user)}</b> ·
        <a href="/" target="_blank">Xem website</a> ·
        <form class="inline" method="post" action="/admin/logout"><button class="ghost">Đăng xuất</button></form></div></div>
    ${flash ? `<div class="msg ${flash.type}">${esc(flash.text)}</div>` : ""}
    <div class="card"><h2>Tạo bài viết mới</h2>
      <form method="post" action="/admin/posts">
        <label>Tiêu đề *</label><input name="title" maxlength="150" required>
        <label>Chuyên mục</label><select name="category">${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
        <label>Ảnh đại diện (link, không bắt buộc)</label><input name="imageUrl" placeholder="https://... hoặc /anh/ten.jpg">
        <label>Mô tả ngắn (hiện ở trang chủ)</label><input name="excerpt" maxlength="300">
        <label>Nội dung *</label><textarea name="content" required placeholder="Các đoạn cách nhau một dòng trống"></textarea>
        <p><button>Đăng bài &amp; đồng bộ trang chủ</button></p>
      </form></div>
    <div class="card"><div class="top"><h2 style="margin:0">Bài đã đăng (${posts.length})</h2>
      <form method="post" action="/admin/sync"><button class="ghost">Đồng bộ lại index.html</button></form></div>
      <table><tr><th>Bài viết</th><th>Ngày đăng</th><th></th></tr>${rows || '<tr><td colspan="3">Chưa có bài viết.</td></tr>'}</table>
      <p><small>Trang chủ hiển thị ${HOME_LIMIT} bài mới nhất.</small></p>
    </div>
    <div class="card"><h2>Đổi tên đăng nhập / mật khẩu</h2>
      <form method="post" action="/admin/account">
        <label>Mật khẩu hiện tại *</label><input name="current" type="password" autocomplete="current-password" required>
        <label>Tên đăng nhập mới</label><input name="username" value="${esc(user)}" required minlength="3" maxlength="32">
        <label>Mật khẩu mới (để trống nếu không đổi)</label><input name="password" type="password" autocomplete="new-password" minlength="${MIN_PW}">
        <label>Nhập lại mật khẩu mới</label><input name="password2" type="password" autocomplete="new-password" minlength="${MIN_PW}">
        <p><button>Lưu thay đổi</button></p>
      </form></div>`,
    );
}

async function handleAdmin(req, res, url) {
    const p = url.pathname.replace(/\/+$/, "") || "/admin";
    const session = getSession(req);

    // Chặn gửi form từ trang web khác
    if (req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host)
            return send(res, 403, "Forbidden", ADMIN_HEADERS);
    }

    // Chưa có tài khoản → mọi đường vào /admin đều dẫn tới form tạo tài khoản
    if (!hasAdmin()) {
        if (p === "/admin/setup" && req.method === "POST") {
            const b = await readBody(req);
            const username = (b.get("username") || "").trim();
            const pw = b.get("password") || "";
            let err = "";
            if (!validUsername(username))
                err =
                    "Tên đăng nhập phải 3–32 ký tự, chỉ gồm chữ, số và . _ @ -";
            else if (pw.length < MIN_PW)
                err = `Mật khẩu tối thiểu ${MIN_PW} ký tự.`;
            else if (pw !== b.get("password2"))
                err = "Hai mật khẩu nhập không giống nhau.";
            if (err) return send(res, 400, setupPage(err), ADMIN_HEADERS);
            try {
                fs.writeFileSync(
                    ADMIN_FILE,
                    JSON.stringify({ username, ...hashPw(pw) }, null, 2),
                    { flag: "wx" },
                );
            } catch {
                return redirect(res, "/admin/login");
            } // đã có người tạo trước
            const sid = crypto.randomBytes(32).toString("hex");
            sessions.set(sid, {
                user: username,
                expires: Date.now() + SESSION_TTL,
            });
            return redirect(
                res,
                "/admin?m=" + encodeURIComponent("Đã tạo tài khoản quản trị."),
                {
                    "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`,
                },
            );
        }
        if (req.method === "GET")
            return send(res, 200, setupPage(), ADMIN_HEADERS);
        return redirect(res, "/admin");
    }
    if (p === "/admin/setup") return redirect(res, "/admin/login");

    if (p === "/admin/login" && req.method === "GET") {
        return session
            ? redirect(res, "/admin")
            : send(res, 200, loginPage(), ADMIN_HEADERS);
    }

    if (p === "/admin/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress;
        const f = loginFails.get(ip);
        if (f && f.until > Date.now())
            return send(
                res,
                429,
                loginPage("Sai quá nhiều lần. Thử lại sau vài phút."),
                ADMIN_HEADERS,
            );
        const body = await readBody(req);
        const admin = readJSON(ADMIN_FILE, null);
        const ok =
            admin &&
            body.get("username") === admin.username &&
            checkPw(body.get("password") || "", admin);
        if (!ok) {
            const count = (f?.count || 0) + 1;
            loginFails.set(ip, {
                count,
                until: count >= 5 ? Date.now() + 5 * 60 * 1000 : 0,
            });
            return send(
                res,
                401,
                loginPage("Sai tên đăng nhập hoặc mật khẩu."),
                ADMIN_HEADERS,
            );
        }
        loginFails.delete(ip);
        const sid = crypto.randomBytes(32).toString("hex");
        sessions.set(sid, {
            user: admin.username,
            expires: Date.now() + SESSION_TTL,
        });
        return redirect(res, "/admin", {
            "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`,
        });
    }

    if (!session) return redirect(res, "/admin/login");

    if (p === "/admin/logout" && req.method === "POST") {
        sessions.delete(parseCookies(req).sid);
        return redirect(res, "/admin/login", {
            "Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        });
    }

    if (p === "/admin" && req.method === "GET") {
        const m = url.searchParams.get("m");
        const e = url.searchParams.get("e");
        const flash = m
            ? { type: "ok", text: m }
            : e
              ? { type: "err", text: e }
              : null;
        return send(
            res,
            200,
            dashboardPage(session.user, flash),
            ADMIN_HEADERS,
        );
    }

    if (p === "/admin/posts" && req.method === "POST") {
        const b = await readBody(req);
        const title = (b.get("title") || "").trim().slice(0, 150);
        const content = (b.get("content") || "").trim().slice(0, 50000);
        const category = CATEGORIES.includes(b.get("category"))
            ? b.get("category")
            : CATEGORIES[0];
        const excerpt = (b.get("excerpt") || "").trim().slice(0, 300);
        const imageUrl = safeImage((b.get("imageUrl") || "").trim());
        if (!title || !content)
            return redirect(
                res,
                "/admin?e=" +
                    encodeURIComponent("Cần nhập tiêu đề và nội dung."),
            );

        const posts = readPosts();
        let slug = slugify(title),
            n = 2;
        while (posts.some((x) => x.slug === slug))
            slug = `${slugify(title)}-${n++}`;
        const post = {
            id: crypto.randomUUID(),
            slug,
            title,
            category,
            excerpt,
            imageUrl,
            content,
            createdAt: new Date().toISOString(),
        };

        writeAtomic(path.join(POST_DIR, slug + ".html"), renderPostPage(post));
        posts.push(post);
        savePosts(posts);
        syncIndex();
        return redirect(
            res,
            "/admin?m=" +
                encodeURIComponent("Đã đăng bài và cập nhật index.html."),
        );
    }

    if (p === "/admin/posts/delete" && req.method === "POST") {
        const id = (await readBody(req)).get("id");
        const posts = readPosts();
        const post = posts.find((x) => x.id === id);
        if (post) {
            savePosts(posts.filter((x) => x.id !== id));
            fs.rmSync(path.join(POST_DIR, post.slug + ".html"), {
                force: true,
            });
            syncIndex();
        }
        return redirect(
            res,
            "/admin?m=" +
                encodeURIComponent(
                    post
                        ? "Đã xóa bài và cập nhật index.html."
                        : "Không tìm thấy bài.",
                ),
        );
    }

    if (p === "/admin/account" && req.method === "POST") {
        const b = await readBody(req);
        const admin = readJSON(ADMIN_FILE, null);
        const back = (k, t) =>
            redirect(res, `/admin?${k}=` + encodeURIComponent(t));
        if (!admin || !checkPw(b.get("current") || "", admin))
            return back("e", "Mật khẩu hiện tại không đúng.");
        const username = (b.get("username") || "").trim();
        const pw = b.get("password") || "";
        if (!validUsername(username))
            return back(
                "e",
                "Tên đăng nhập phải 3–32 ký tự, chỉ gồm chữ, số và . _ @ -",
            );
        if (pw && pw.length < MIN_PW)
            return back("e", `Mật khẩu mới tối thiểu ${MIN_PW} ký tự.`);
        if (pw && pw !== b.get("password2"))
            return back("e", "Hai mật khẩu mới không giống nhau.");
        writeAtomic(
            ADMIN_FILE,
            JSON.stringify(
                {
                    username,
                    ...(pw
                        ? hashPw(pw)
                        : { salt: admin.salt, hash: admin.hash }),
                },
                null,
                2,
            ),
        );
        session.user = username;
        return back("m", "Đã cập nhật tài khoản.");
    }

    if (p === "/admin/sync" && req.method === "POST") {
        syncIndex();
        return redirect(
            res,
            "/admin?m=" + encodeURIComponent("Đã đồng bộ lại index.html."),
        );
    }

    return send(res, 404, "Không tìm thấy", ADMIN_HEADERS);
}

/* Chỉ phục vụ: trang chủ, các bài viết và thư mục assets/ (css, img, font, js...).
 * Tuyệt đối không lộ server.js hay thư mục data/. */
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
};
const ASSETS_DIR = path.join(ROOT, "assets");

function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD")
        return send(res, 405, "Method Not Allowed");
    let file = null;
    if (pathname === "/" || pathname === "/index.html") file = INDEX_FILE;
    else if (/^\/bai-viet\/[a-z0-9-]+\.html$/.test(pathname))
        file = path.join(POST_DIR, path.basename(pathname));
    else if (pathname.startsWith("/assets/")) {
        const candidate = path.resolve(ROOT, "." + pathname);
        // Chặn thoát ra ngoài thư mục assets (../) và chỉ cho các đuôi file đã biết
        if (
            candidate.startsWith(ASSETS_DIR + path.sep) &&
            MIME[path.extname(candidate).toLowerCase()]
        )
            file = candidate;
    }
    let stat = null;
    try {
        stat = file ? fs.statSync(file) : null;
    } catch {
        stat = null;
    }
    if (!stat || !stat.isFile()) return send(res, 404, "Không tìm thấy trang");
    res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()],
        "Content-Length": stat.size,
        "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))
            return await handleAdmin(req, res, url);
        let pathname;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            return send(res, 400, "Bad Request");
        }
        return serveStatic(req, res, pathname);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) send(res, 500, "Lỗi máy chủ");
    }
});

// Chỉ đồng bộ lúc khởi động khi đã có bài (giữ nguyên bài mẫu nếu chưa đăng bài nào)
try {
    if (readPosts().length) syncIndex();
} catch (e) {
    console.error("Cảnh báo:", e.message);
}
server.listen(PORT, () =>
    console.log(
        `Website:  http://localhost:${PORT}/\nQuản trị: http://localhost:${PORT}/admin`,
    ),
);
