$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$objectDir = Join-Path ([IO.Path]::GetTempPath()) "easykey-obj-$PID"

# zig cc 忽略 -nostartfiles，而 -nostdlib 会同时砍掉 musl 头文件搜索路径，
# 所以分两步：先带头文件编译成 bitcode，再脱离 libc 链接。
$compile = @(
    "-target", "aarch64-linux-musl",
    "-O2", "-flto",
    "-fdata-sections", "-ffunction-sections",
    "-fno-asynchronous-unwind-tables", "-fno-unwind-tables",
    "-fno-stack-protector",
    "-Wall", "-Wextra", "-Werror",
    "-c"
)
$link = @(
    "-target", "aarch64-linux-musl",
    "-flto", "-nostdlib", "-static", "-s",
    "-Wl,--gc-sections", "-Wl,--build-id=none", "-Wl,-z,norelro"
)
$sources = @("EasyKey", "core", "start")

Push-Location $root
try {
    New-Item -ItemType Directory -Path $objectDir -Force | Out-Null
    $objects = @()
    foreach ($name in $sources) {
        $object = Join-Path $objectDir "$name.o"
        & uv run --no-project --with ziglang python -m ziglang cc @compile "src/$name.c" -o $object
        if ($LASTEXITCODE -ne 0) { throw "$name.c 编译失败" }
        $objects += $object
    }
    & uv run --no-project --with ziglang python -m ziglang cc @link @objects -o "module/EasyKey"
    if ($LASTEXITCODE -ne 0) { throw "EasyKey 链接失败" }
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $objectDir) { Remove-Item -LiteralPath $objectDir -Recurse -Force }
}
