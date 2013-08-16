#ifndef _SYS_FSUID_H
#define _SYS_FSUID_H

#include <features.h>
#include <sys/types.h>

__BEGIN_DECLS

extern int setfsuid(uid_t uid);
extern int setfsgid(gid_t gid);

__END_DECLS

#endif
