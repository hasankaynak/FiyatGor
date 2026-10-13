@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo ========================================================
echo   MD Ticaret FiyatGor - GitHub Sürüm Yayınlama Aracı
echo ========================================================
echo.

set NEW_VER=%~1
set RELEASE_NOTES=%~2

if "%NEW_VER%"=="" (
    set /p NEW_VER="Yayınlanacak Yeni Versiyon Numarası (Örn: 1.0.13): "
)

if "%RELEASE_NOTES%"=="" (
    set /p RELEASE_NOTES="Sürüm Notu / Açıklama: "
)

if "%NEW_VER%"=="" (
    echo [HATA] Versiyon numarası boş olamaz!
    pause
    exit /b 1
)

echo.
echo [1/3] APK dosyası kontrol ediliyor...
if not exist "FiyatGor.apk" (
    if exist "android\app\build\outputs\apk\release\app-release.apk" (
        copy /y "android\app\build\outputs\apk\release\app-release.apk" "FiyatGor.apk"
    ) else if exist "app-release.apk" (
        copy /y "app-release.apk" "FiyatGor.apk"
    ) else if exist "..\FiyatGor.apk" (
        copy /y "..\FiyatGor.apk" "FiyatGor.apk"
    ) else (
        echo [UYARI] FiyatGor.apk bulunamadı! Önce build-apk.bat çalıştırıp derleyin.
        pause
        exit /b 1
    )
)

echo.
echo [2/3] version.json güncelleniyor...
(
    echo {
    echo   "version": "%NEW_VER%",
    echo   "versionCode": 99,
    echo   "url": "https://github.com/hasankaynak/FiyatGor/releases/download/v%NEW_VER%/FiyatGor.apk",
    echo   "releaseNotes": "%RELEASE_NOTES%"
    echo }
) > version.json

git add version.json
git commit -m "chore: release v%NEW_VER%"
git push origin main

echo.
echo [3/3] GitHub Release oluşturuluyor ve APK yükleniyor...
gh release create "v%NEW_VER%" ./FiyatGor.apk --title "MD Ticaret Fiyat Gör v%NEW_VER%" --notes "%RELEASE_NOTES%"

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo   BAŞARILI! Sürüm v%NEW_VER% GitHub'da yayınlandı!
    echo   Mobil cihazlar uygulamayı açtıklarında veya Ayarlar'dan
    echo   güncelleme kontrolü yaptıklarında yeni sürümü indirecek.
    echo ========================================================
) else (
    echo.
    echo [HATA] GitHub Release oluşturulurken bir sorun oluştu.
)

pause
