@echo off
:: Chuyển trực tiếp đến thư mục dự án (bao gồm cả chuyển ổ đĩa)
cd /d "E:\TTSHLX_CODE\Automation"

echo Dang khoi dong du an Automation luc %TIME%...

:: Kiểm tra xem npm có tồn tại không trước khi chạy
call npm run dev2