#ifndef _SYS_GMON_H
#define _SYS_GMON_H

#include <features.h>
#include <sys/types.h>

struct __bb {
  long              zero_word;
  const char        *filename;
  long              *counts;
  long              ncounts;
  struct __bb       *next;
  const unsigned long *addresses;
};

extern struct __bb *__bb_head;

#define HISTCOUNTER     unsigned short
#define HISTFRACTION    2
#define HASHFRACTION    2
#define ARCDENSITY      3
#define MINARCS         50
#define ARCINDEX        u_long
#define MAXARCS         (1 << 20)

struct tostruct {
    u_long      selfpc;
    long        count;
    ARCINDEX    link;
};

struct rawarc {
    u_long    raw_frompc;
    u_long    raw_selfpc;
    long      raw_count;
};

#define ROUNDDOWN(x,y)  (((x)/(y))*(y))
#define ROUNDUP(x,y)    ((((x)+(y)-1)/(y))*(y))

struct gmonparam {
    long int       state;
    u_short        *kcount;
    u_long         kcountsize;
    ARCINDEX       *froms;
    u_long         fromssize;
    struct tostruct    *tos;
    u_long        tossize;
    long          tolimit;
    u_long        lowpc;
    u_long        highpc;
    u_long        textsize;
    u_long        hashfraction;
    long          log_hashfraction;
};

#define GMON_PROF_ON    0
#define GMON_PROF_BUSY  1
#define GMON_PROF_ERROR 2
#define GMON_PROF_OFF   3

#define GPROF_STATE    0
#define GPROF_COUNT    1
#define GPROF_FROMS    2
#define GPROF_TOS      3
#define GPROF_GMONPARAM 4

__BEGIN_DECLS

extern void __monstartup(u_long lowpc, u_long highpc);
extern void monstartup(u_long lowpc, u_long highpc);
extern void _mcleanup(void);

__END_DECLS

#endif
