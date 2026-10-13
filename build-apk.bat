@echo off
REM ========================================
REM FiyatGor - Android APK Build Script
REM ========================================

echo.
echo ========================================
echo   FiyatGor Android APK Olusturuluyor...
echo ========================================
echo.

REM ADIM 1: Expo Prebuild
echo [1/3] Native Android projesi olusturuluyor...
call npx expo prebuild --platform android --clean
if errorlevel 1 (
    echo HATA: Prebuild basarisiz!
    pause
    exit /b 1
)
echo      Basarili!

REM ADIM 2: Android klasorune git
echo [2/3] Gradle build baslatiliyor...
cd android
if errorlevel 1 (
    echo HATA: android klasoru bulunamadi!
    pause
    exit /b 1
)

REM ADIM 3: Gradle ile APK olustur
echo [3/3] APK derleniyor (bu islem 5-10 dakika surebilir)...
call gradlew assembleRelease
if errorlevel 1 (
    echo HATA: Gradle build basarisiz!
    echo.
    echo Muhtemel sorunlar:
    echo - Java JDK kurulu degil
    echo - Android SDK kurulu degil
    echo - ANDROID_HOME environment variable ayarlanmamis
    pause
    exit /b 1
)

echo.
echo ========================================
echo   APK Basariyla Olusturuldu!
echo ========================================
echo.
echo APK Konumu:
echo android\app\build\outputs\apk\release\app-release.apk
echo.
echo Bu dosyayi telefonunuza yukleyebilirsiniz!
echo.
pause
