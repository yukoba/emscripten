#ifndef _INTERNAL_ATOMIC_H
#define _INTERNAL_ATOMIC_H

#include <stdint.h>
#include <stdlib.h>

static inline int a_ctz_64(uint64_t x)
{
    for (int i = 0; i < 64; i++) {
        if ( (x >> i) & 1 ) {
            return i;
        }
    }
    return 64;
}

static inline int a_ctz_l(unsigned long x)
{
    for (int i = 0; i < 32; i++) {
        if ( (x >> i) & 1 ) {
            return i;
        }
    }
    return 32;
}

static inline void a_and_64(volatile uint64_t *p, uint64_t v)
{
    *p &= v;
}

static inline void a_or_64(volatile uint64_t *p, uint64_t v)
{
    *p |= v;
}

static inline void a_store_l(volatile void *p, long x)
{
    *(long*)p = x;
}

static inline void a_or_l(volatile void *p, long v)
{
    *(long*)p |= v;
}

static inline void *a_cas_p(volatile void *p, void *t, void *s)
{
    void* tmp = *(void**)p;
    if (tmp == t) {
        *(void**)p = s;
    }
    return tmp;
}

static inline long a_cas_l(volatile void *p, long t, long s)
{
    long tmp = *(long*)p;
    if (tmp == t) {
        *(long*)p = s;
    }
    return tmp;
}

static inline int a_cas(volatile int *p, int t, int s)
{
    int tmp = *p;
    if (tmp == t) {
        *p = s;
    }
    return tmp;
}

static inline void *a_swap_p(void *volatile *x, void *v)
{
    void* tmp = *x;
    *x = v;
    return tmp;
}
static inline long a_swap_l(volatile void *x, long v)
{
    long tmp = *(long*)x;
    *(long*)x = v;
    return tmp;
}

static inline void a_or(volatile void *p, int v)
{
    *(int*)p |= v;
}

static inline void a_and(volatile void *p, int v)
{
    *(int*)p &= v;
}

static inline int a_swap(volatile int *x, int v)
{
    int tmp = *x;
    *x = v;
    return tmp;
}

#define a_xchg a_swap

static inline int a_fetch_add(volatile int *x, int v)
{
    int tmp = *x;
    *x += v;
    return tmp;
}

static inline void a_inc(volatile int *x)
{
    *x++;
}

static inline void a_dec(volatile int *x)
{
    *x--;
}

static inline void a_store(volatile int *p, int x)
{
    *p = x;
}

static inline void a_spin()
{
    abort(); // Impossible to implement
}

static inline void a_crash()
{
    abort();
}


#endif
