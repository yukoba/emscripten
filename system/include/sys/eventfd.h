#ifndef	_SYS_EVENTFD_H
#define	_SYS_EVENTFD_H

#include <stdint.h>

typedef uint64_t eventfd_t;

enum {
    EFD_SEMAPHORE = 1,
#define EFD_SEMAPHORE EFD_SEMAPHORE
    EFD_CLOEXEC = 02000000,
#define EFD_CLOEXEC EFD_CLOEXEC
    EFD_NONBLOCK = 04000
#define EFD_NONBLOCK EFD_NONBLOCK
};

__BEGIN_DECLS

extern int eventfd(int count, int flags);
extern int eventfd_read(int fd, eventfd_t *value);
extern int eventfd_write(int fd, eventfd_t value);

__END_DECLS

#endif
