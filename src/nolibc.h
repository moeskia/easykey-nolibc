/* 直连 aarch64 Linux 系统调用的最小运行时。
 *
 * 只借用 musl / Linux 头文件里的常量与结构体（纯编译期），不链接 libc：
 * 构建时用 -nostdlib，进程入口、vfork 与 mem* 由 src/start.c 提供。
 *
 * 系统调用直接返回负的错误码，调用方比较 -EINTR 之类即可。这里不使用 errno，
 * musl 的 errno 展开成 __errno_location() 调用，脱离 libc 后没有该符号。
 *
 * aarch64 缺少 open / poll / fork / vfork / signal 这几个系统调用号，
 * 分别用 openat / ppoll / clone / rt_sigaction 替代。
 */
#ifndef EASYKEY_NOLIBC_H
#define EASYKEY_NOLIBC_H

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>

/* 寄存器约定与 musl arch/aarch64/syscall_arch.h 一致：x8 传号，x0-x4 传参 */
#define EK_SYSCALL(...)                                                          \
    do {                                                                         \
        __asm__ __volatile__("svc 0" : "=r"(x0) : __VA_ARGS__ : "memory", "cc"); \
        return x0;                                                               \
    } while (0)

static inline long ek_syscall1(long number, long a)
{
    register long x8 __asm__("x8") = number;
    register long x0 __asm__("x0") = a;
    EK_SYSCALL("r"(x8), "0"(x0));
}

static inline long ek_syscall2(long number, long a, long b)
{
    register long x8 __asm__("x8") = number;
    register long x0 __asm__("x0") = a;
    register long x1 __asm__("x1") = b;
    EK_SYSCALL("r"(x8), "0"(x0), "r"(x1));
}

static inline long ek_syscall3(long number, long a, long b, long c)
{
    register long x8 __asm__("x8") = number;
    register long x0 __asm__("x0") = a;
    register long x1 __asm__("x1") = b;
    register long x2 __asm__("x2") = c;
    EK_SYSCALL("r"(x8), "0"(x0), "r"(x1), "r"(x2));
}

static inline long ek_syscall4(long number, long a, long b, long c, long d)
{
    register long x8 __asm__("x8") = number;
    register long x0 __asm__("x0") = a;
    register long x1 __asm__("x1") = b;
    register long x2 __asm__("x2") = c;
    register long x3 __asm__("x3") = d;
    EK_SYSCALL("r"(x8), "0"(x0), "r"(x1), "r"(x2), "r"(x3));
}

static inline long ek_syscall5(long number, long a, long b, long c, long d, long e)
{
    register long x8 __asm__("x8") = number;
    register long x0 __asm__("x0") = a;
    register long x1 __asm__("x1") = b;
    register long x2 __asm__("x2") = c;
    register long x3 __asm__("x3") = d;
    register long x4 __asm__("x4") = e;
    EK_SYSCALL("r"(x8), "0"(x0), "r"(x1), "r"(x2), "r"(x3), "r"(x4));
}

static inline int ek_open(const char *path, int flags)
{
    return (int)ek_syscall4(SYS_openat, AT_FDCWD, (long)path, flags, 0);
}

static inline long ek_read(int fd, void *buffer, size_t length)
{
    return ek_syscall3(SYS_read, fd, (long)buffer, (long)length);
}

static inline int ek_close(int fd)
{
    return (int)ek_syscall1(SYS_close, fd);
}

static inline int ek_ioctl(int fd, unsigned long request, void *argument)
{
    return (int)ek_syscall3(SYS_ioctl, fd, (long)request, (long)argument);
}

/* timeout 为负表示无限等待，与 poll(2) 的语义一致 */
static inline int ek_poll(struct pollfd *fds, unsigned long count, int timeout)
{
    long timespec[2];
    if (timeout < 0)
        return (int)ek_syscall5(SYS_ppoll, (long)fds, (long)count, 0, 0, _NSIG / 8);
    timespec[0] = timeout / 1000;
    timespec[1] = (long)(timeout % 1000) * 1000000;
    return (int)ek_syscall5(SYS_ppoll, (long)fds, (long)count, (long)timespec, 0, _NSIG / 8);
}

static inline void ek_sleep(long seconds)
{
    long timespec[2];
    timespec[0] = seconds;
    timespec[1] = 0;
    ek_syscall2(SYS_nanosleep, (long)timespec, 0);
}

/* 不走 vDSO，直接进内核；单次多花几百纳秒，换掉一页常驻内存 */
static inline int64_t ek_now_ms(void)
{
    long timespec[2];
    if (ek_syscall2(SYS_clock_gettime, CLOCK_MONOTONIC, (long)timespec) < 0)
        return 0;
    return (int64_t)timespec[0] * 1000 + timespec[1] / 1000000;
}

static inline int ek_inotify_init(int flags)
{
    return (int)ek_syscall1(SYS_inotify_init1, flags);
}

static inline int ek_inotify_watch(int fd, const char *path, uint32_t mask)
{
    return (int)ek_syscall3(SYS_inotify_add_watch, fd, (long)path, (long)mask);
}

/* arm64 内核的 struct sigaction：没有 sa_restorer，sigset 固定 8 字节 */
struct ek_kernel_sigaction {
    void (*handler)(int);
    unsigned long flags;
    unsigned long mask;
};

static inline int ek_ignore_signal(int signal_number)
{
    struct ek_kernel_sigaction action;
    action.handler = SIG_IGN;
    action.flags = 0;
    action.mask = 0;
    return (int)ek_syscall4(SYS_rt_sigaction, signal_number, (long)&action, 0, _NSIG / 8);
}

static inline int ek_execve(const char *path, char *const argv[], char *const envp[])
{
    return (int)ek_syscall3(SYS_execve, (long)path, (long)argv, (long)envp);
}

__attribute__((noreturn)) static inline void ek_exit(int code)
{
    ek_syscall1(SYS_exit_group, code);
    __builtin_unreachable();
}

/* 子进程与父进程共享栈，无法用 C 表达，实现在 src/start.c 的汇编里 */
extern int ek_vfork(void) __attribute__((returns_twice));

/* 由 src/start.c 从初始栈上取回，execve 时原样传给子进程 */
extern char **ek_environ;

#endif
