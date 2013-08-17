bits/alltypes.h is created by this.

cd system/musl
sed -f tools/mkalltypes.sed arch/i386/bits/alltypes.h.in include/alltypes.h.in > ../include/musl/arch/js/bits/alltypes.h

