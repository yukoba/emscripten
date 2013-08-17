#ifndef _INTERNAL_ATOMIC_H
#define _INTERNAL_ATOMIC_H

#include <stdint.h>

static inline int a_ctz_64(uint64_t x)
{
	return 0;
}

static inline int a_ctz_l(unsigned long x)
{
	return 0;
}

static inline void a_and_64(volatile uint64_t *p, uint64_t v)
{
}

static inline void a_or_64(volatile uint64_t *p, uint64_t v)
{
}

static inline void a_store_l(volatile void *p, long x)
{
}

static inline void a_or_l(volatile void *p, long v)
{
}

static inline void *a_cas_p(volatile void *p, void *t, void *s)
{
	return 0;
}

static inline long a_cas_l(volatile void *p, long t, long s)
{
	return 0;
}

static inline int a_cas(volatile int *p, int t, int s)
{
	return 0;
}

static inline void *a_swap_p(void *volatile *x, void *v)
{
	return 0;
}
static inline long a_swap_l(volatile void *x, long v)
{
	return 0;
}

static inline void a_or(volatile void *p, int v)
{
}

static inline void a_and(volatile void *p, int v)
{
}

static inline int a_swap(volatile int *x, int v)
{
	return 0;
}

#define a_xchg a_swap

static inline int a_fetch_add(volatile int *x, int v)
{
	return 0;
}

static inline void a_inc(volatile int *x)
{
}

static inline void a_dec(volatile int *x)
{
}

static inline void a_store(volatile int *p, int x)
{
}

static inline void a_spin()
{
}

static inline void a_crash()
{
}


#endif
