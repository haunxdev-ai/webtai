#!/bin/bash
cd "$(dirname "$0")"
echo "Đang khởi động máy chủ... (đóng cửa sổ này để tắt)"
(sleep 1; (open http://localhost:3000/admin || xdg-open http://localhost:3000/admin) >/dev/null 2>&1) &
node server.js
