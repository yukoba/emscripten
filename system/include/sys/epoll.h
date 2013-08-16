#ifndef	_SYS_EPOLL_H
#define	_SYS_EPOLL_H

#include <stdint.h>
#include <sys/types.h>

#ifndef __sigset_t_defined
# define __sigset_t_defined
typedef __sigset_t sigset_t;
#endif

enum {
    EPOLL_CLOEXEC = 02000000,
#define EPOLL_CLOEXEC EPOLL_CLOEXEC
    EPOLL_NONBLOCK = 04000
#define EPOLL_NONBLOCK EPOLL_NONBLOCK
};

enum EPOLL_EVENTS {
    EPOLLIN = 0x001,
#define EPOLLIN EPOLLIN
    EPOLLPRI = 0x002,
#define EPOLLPRI EPOLLPRI
    EPOLLOUT = 0x004,
#define EPOLLOUT EPOLLOUT
    EPOLLRDNORM = 0x040,
#define EPOLLRDNORM EPOLLRDNORM
    EPOLLRDBAND = 0x080,
#define EPOLLRDBAND EPOLLRDBAND
    EPOLLWRNORM = 0x100,
#define EPOLLWRNORM EPOLLWRNORM
    EPOLLWRBAND = 0x200,
#define EPOLLWRBAND EPOLLWRBAND
    EPOLLMSG = 0x400,
#define EPOLLMSG EPOLLMSG
    EPOLLERR = 0x008,
#define EPOLLERR EPOLLERR
    EPOLLHUP = 0x010,
#define EPOLLHUP EPOLLHUP
    EPOLLRDHUP = 0x2000,
#define EPOLLRDHUP EPOLLRDHUP
    EPOLLONESHOT = 1u << 30,
#define EPOLLONESHOT EPOLLONESHOT
    EPOLLET = 1u << 31
#define EPOLLET EPOLLET
};

#define EPOLL_CTL_ADD 1
#define EPOLL_CTL_DEL 2
#define EPOLL_CTL_MOD 3

typedef union epoll_data {
  void *ptr;
  int fd;
  uint32_t u32;
  uint64_t u64;
} epoll_data_t;

struct epoll_event {
  uint32_t events;
  epoll_data_t data;
} __attribute__ ((__packed__));

__BEGIN_DECLS

extern int epoll_create(int size)
extern int epoll_create1(int flags);
extern int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
extern int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
extern int epoll_pwait(int epfd, struct epoll_event *events, int maxevents, int timeout, const __sigset_t *ss);

__END_DECLS

#endif
