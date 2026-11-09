@echo off
setlocal
rem Builds app\build\outputs\apk\release\app-release.apk using the JDK and
rem Android SDK already downloaded for the other app on this machine.
set "TOOLS=%~dp0..\..\winpeak-app\android\.apk-tools"
set "JAVA_HOME=%TOOLS%\jdk"
set "ANDROID_HOME=%TOOLS%\android-sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "GRADLE_OPTS=-Xmx2g -Dfile.encoding=UTF-8"

cd /d "%~dp0"
call gradlew.bat assembleRelease --no-daemon --stacktrace
