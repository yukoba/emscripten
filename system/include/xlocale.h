
#ifndef _XLOCALE_H_
#define _XLOCALE_H_

#include <string.h>
#include <locale.h>

#ifdef __cplusplus
extern "C" {
#endif

#define _CTYPE_U        0x01
#define _CTYPE_L        0x02
#define _CTYPE_N        0x04
#define _CTYPE_S        0x08
#define _CTYPE_P        0x10
#define _CTYPE_C        0x20
#define _CTYPE_X        0x40
#define _CTYPE_B        0x80
#define _CTYPE_A        0x100
#define _CTYPE_G        0x200
#define _CTYPE_R        0x400

#define _CTYPE_D        0x04

long long strtoll_l(const char *start, char **end, int base, locale_t loc);
unsigned long long strtoull_l(const char *start, char **end, int base, locale_t loc);
double strtold_l(const char *start, char **end, locale_t loc);

int strcoll_l(const char *s1, const char *s2, locale_t locale);
int wcscoll_l(const wchar_t *ws1, const wchar_t *ws2, locale_t locale);

size_t strxfrm_l(char *s1, const char *s2, size_t n, locale_t locale);
size_t wcsxfrm_l(wchar_t *ws1, const wchar_t *ws2, size_t n, locale_t locale);

int isxdigit_l(int c, locale_t locale);
int isdigit_l(int c, locale_t locale);

int iswspace_l(wint_t wc, locale_t locale);
int iswupper_l(wint_t wc, locale_t locale);
int iswlower_l(wint_t wc, locale_t locale);
int iswprint_l(wint_t wc, locale_t locale);
int iswcntrl_l(wint_t wc, locale_t locale);
int iswalpha_l(wint_t wc, locale_t locale);
int iswdigit_l(wint_t wc, locale_t locale);
int iswpunct_l(wint_t wc, locale_t locale);
int iswblank_l(wint_t wc, locale_t locale);
int iswxdigit_l(wint_t wc, locale_t locale);

size_t strftime_l(char *s, size_t maxsize, const char *format, const struct tm *timeptr, locale_t locale);

#ifdef __cplusplus
}
#endif

#endif /* _LOCALE_H_ */

