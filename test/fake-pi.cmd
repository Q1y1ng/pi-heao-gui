@ECHO off
SETLOCAL
SET "_prog=node"
node "%~dp0\fake-pi.cjs" %*
