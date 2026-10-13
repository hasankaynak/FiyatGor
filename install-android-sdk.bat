@echo off
REM ========================================
REM Android SDK Minimal Kurulum
REM ========================================

echo.
echo ========================================
echo   Android SDK Yukleniyor...
echo ========================================
echo.

REM SDK klasörü oluştur
set SDK_DIR=C:\Users\Administrator\AppData\Local\Android\Sdk
if not exist "%SDK_DIR%" mkdir "%SDK_DIR%"
if not exist "%SDK_DIR%\cmdline-tools" mkdir "%SDK_DIR%\cmdline-tools"

echo [1/4] Android Command Line Tools indiriliyor...
echo.
echo Lutfen asagidaki adresten "Command line tools only" indirin:
echo https://developer.android.com/studio#command-line-tools-only
echo.
echo Indirdiginiz ZIP'i su klasore cikarin:
echo %SDK_DIR%\cmdline-tools\
echo.
echo Sonra bu script'i tekrar çalistirin.
echo.
pause
exit /b 0

:install_sdk
echo [2/4] SDK Manager ile paketler yukleniyor...
cd /d "%SDK_DIR%\cmdline-tools\latest\bin"

REM Lisanslari kabul et
echo y | sdkmanager.bat --licenses

REM Gerekli paketleri yükle
sdkmanager.bat "platform-tools" "platforms;android-34" "build-tools;34.0.0"

echo.
echo [3/4] Environment variable ayarlaniyor...
setx ANDROID_HOME "%SDK_DIR%"
setx Path "%Path%;%SDK_DIR%\platform-tools;%SDK_DIR%\cmdline-tools\latest\bin"

echo.
echo [4/4] Tamamlandi!
echo.
echo ========================================
echo   Android SDK Kuruldu!
echo ========================================
echo.
echo SDK Konumu: %SDK_DIR%
echo.
echo Simdi Gradle build yapabilirsiniz:
echo cd android
echo gradlew assembleRelease
echo.
pause
