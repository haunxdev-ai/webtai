(function () {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    document.querySelectorAll(".float-contact a").forEach(function (btn, i) {
        var inner = document.createElement("span");
        inner.className = "fc-inner";
        while (btn.firstChild) inner.appendChild(btn.firstChild);
        btn.appendChild(inner);

        if (reduce) return;

        [0, 700].forEach(function (delay) {
            var ring = document.createElement("span");
            ring.className = "fc-ring";
            btn.insertBefore(ring, inner);

            ring.animate(
                [
                    { transform: "scale(1)", opacity: 0.55 },
                    { transform: "scale(1.9)", opacity: 0 },
                ],
                {
                    duration: 1800,
                    delay: delay + i * 250,
                    iterations: Infinity,
                    easing: "ease-out",
                },
            );
        });

        function shake() {
            inner.animate(
                [
                    { transform: "rotate(0deg)" },
                    { transform: "rotate(-18deg)" },
                    { transform: "rotate(18deg)" },
                    { transform: "rotate(-14deg)" },
                    { transform: "rotate(14deg)" },
                    { transform: "rotate(-8deg)" },
                    { transform: "rotate(8deg)" },
                    { transform: "rotate(0deg)" },
                ],
                { duration: 700, easing: "ease-in-out" },
            );
        }

        setTimeout(function () {
            shake();
            setInterval(shake, 2500);
        }, i * 400);

        btn.addEventListener("mouseenter", shake);
    });
})();

(function () {
    var row = document.querySelector(".press-row");
    if (!row) return;

    var wrap = document.createElement("div");
    wrap.className = "press-marquee";
    row.parentNode.insertBefore(wrap, row);
    wrap.appendChild(row);

    var items = Array.from(row.children);
    items.forEach(function (item) {
        var clone = item.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        row.appendChild(clone);
    });
})();

// Bật/tắt menu trên mobile
const menuToggle = document.getElementById("menu-toggle");
const nav = document.getElementById("nav");
if (menuToggle && nav) {
    menuToggle.addEventListener("click", () => nav.classList.toggle("open"));
}

// Thu gọn/mở rộng mục lục
const tocToggle = document.getElementById("toc-toggle");
const toc = document.getElementById("toc");
if (tocToggle && toc) {
    tocToggle.addEventListener("click", () =>
        toc.classList.toggle("collapsed"),
    );
}
