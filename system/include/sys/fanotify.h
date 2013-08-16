#ifndef	_SYS_FANOTIFY_H
#define	_SYS_FANOTIFY_H

#include <stdint.h>
#include <linux/fanotify.h>

__BEGIN_DECLS

extern int fanotify_init(unsigned int flags, unsigned int event_f_flags);
extern int fanotify_mark(int fanotify_fd, unsigned int flags, uint64_t mask, int dfd, const char *pathname);

__END_DECLS

#endif
