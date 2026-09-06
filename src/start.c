/* 替代 musl 启动运行时的三件套：进程入口、vfork、mem*。
 * 与 src/nolibc.h 配合，构建时用 -nostdlib，不链接任何 libc 目标文件。
 */
#include "nolibc.h"

/* 内核进入时只有 sp 有效：[sp] 是 argc，随后依次是 argv、NULL、envp。
 * 这里把 sp 交给 C 代码解析，再由 ek_start 调用 ek_main 并结束进程。
 */
__asm__(".text\n"
        ".globl _start\n"
        ".type _start,%function\n"
        "_start:\n"
        "  mov x0, sp\n"
        "  b ek_start\n");

/* SYS_clone = 220，SIGCHLD | CLONE_VM | CLONE_VFORK = 0x4111。
 * 与 musl src/process/aarch64/vfork.s 相同：子进程共享父进程的栈，
 * 返回后只允许 execve 或 exit，中间不能改动栈上的数据。
 */
__asm__(".text\n"
        ".globl ek_vfork\n"
        ".type ek_vfork,%function\n"
        "ek_vfork:\n"
        "  mov x8, 220\n"
        "  mov x0, 0x4111\n"
        "  mov x1, 0\n"
        "  svc 0\n"
        "  ret\n");

char **ek_environ;

int ek_main(void);
__attribute__((noreturn, used)) void ek_start(long *stack);

/* 保留环境变量很关键：Android 的 input / cmd 是 app_process 包装脚本，
 * 缺少 ANDROID_* 变量时会静默失败。
 */
__attribute__((noreturn, used)) void ek_start(long *stack)
{
    long argc = stack[0];
    ek_environ = (char **)&stack[argc + 2];
    ek_exit(ek_main());
}

/* volatile 用来阻止 LLVM 把字节循环重新识别成 memcpy / memset 造成自递归调用。
 * 这里搬运的都是几百字节的配置数据，逐字节复制足够。
 */
void *memcpy(void *restrict destination, const void *restrict source, size_t length)
{
    volatile unsigned char *out = destination;
    const volatile unsigned char *in = source;
    while (length--)
        *out++ = *in++;
    return destination;
}

void *memset(void *destination, int value, size_t length)
{
    volatile unsigned char *out = destination;
    while (length--)
        *out++ = (unsigned char)value;
    return destination;
}

int memcmp(const void *left, const void *right, size_t length)
{
    const volatile unsigned char *a = left;
    const volatile unsigned char *b = right;
    while (length--) {
        if (*a != *b)
            return *a < *b ? -1 : 1;
        a++;
        b++;
    }
    return 0;
}
