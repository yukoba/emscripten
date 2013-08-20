#define __SYSCALL_LL_E(x) \
((union { long long ll; long l[2]; }){ .ll = x }).l[0], \
((union { long long ll; long l[2]; }){ .ll = x }).l[1]
#define __SYSCALL_LL_O(x) __SYSCALL_LL_E((x))

static long __syscall0(long n);
static long __syscall1(long n, long a1);
static long __syscall2(long n, long a1, long a2);
static long __syscall3(long n, long a1, long a2, long a3);
static long __syscall4(long n, long a1, long a2, long a3, long a4);
static long __syscall5(long n, long a1, long a2, long a3, long a4, long a5);
static long __syscall6(long n, long a1, long a2, long a3, long a4, long a5, long a6);

#define __SC_socket      1
#define __SC_bind        2
#define __SC_connect     3
#define __SC_listen      4
#define __SC_accept      5
#define __SC_getsockname 6
#define __SC_getpeername 7
#define __SC_socketpair  8
#define __SC_send        9
#define __SC_recv        10
#define __SC_sendto      11
#define __SC_recvfrom    12
#define __SC_shutdown    13
#define __SC_setsockopt  14
#define __SC_getsockopt  15
#define __SC_sendmsg     16
#define __SC_recvmsg     17
#define __SC_accept4     18
#define __SC_recvmmsg    19
#define __SC_sendmmsg    20
