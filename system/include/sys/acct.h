#ifndef _SYS_ACCT_H
#define _SYS_ACCT_H

#include <features.h>
#include <endian.h>
#include <time.h>
#include <sys/types.h>

__BEGIN_DECLS

#define ACCT_COMM 16

typedef u_int16_t comp_t;

struct acct {
  char ac_flag;
  u_int16_t ac_uid;
  u_int16_t ac_gid;
  u_int16_t ac_tty;
  u_int32_t ac_btime;
  comp_t ac_utime;
  comp_t ac_stime;
  comp_t ac_etime;
  comp_t ac_mem;
  comp_t ac_io;
  comp_t ac_rw;
  comp_t ac_minflt;
  comp_t ac_majflt;
  comp_t ac_swaps;
  u_int32_t ac_exitcode;
  char ac_comm[ACCT_COMM + 1];
  char ac_pad[10];
};

struct acct_v3 {
  char ac_flag;
  char ac_version;
  u_int16_t ac_tty;
  u_int32_t ac_exitcode;
  u_int32_t ac_uid;
  u_int32_t ac_gid;
  u_int32_t ac_pid;
  u_int32_t ac_ppid;
  u_int32_t ac_btime;
  float ac_etime;
  comp_t ac_utime;
  comp_t ac_stime;
  comp_t ac_mem;
  comp_t ac_io;
  comp_t ac_rw;
  comp_t ac_minflt;
  comp_t ac_majflt;
  comp_t ac_swaps;
  char ac_comm[ACCT_COMM];
};

enum {
  AFORK = 0x01,
  ASU = 0x02,
  ACORE = 0x08,
  AXSIG = 0x10
};

#define ACCT_BYTEORDER 0x00
#define AHZ     100

extern int acct(const char *filename);

__END_DECLS

#endif
