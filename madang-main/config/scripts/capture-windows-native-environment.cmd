@echo off
chcp 65001 >nul
call "%MADANG_WINDOWS_VSDEVCMD%" -no_logo -arch=%ORCA_WINDOWS_NATIVE_ARCH% -host_arch=%ORCA_WINDOWS_NATIVE_ARCH%
if errorlevel 1 exit /b 1
echo MADANG_WINDOWS_NATIVE_ENVIRONMENT
set
