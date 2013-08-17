static inline struct pthread *__pthread_self()
{
	static struct pthread self = {0};
	return &self;
}

#define TP_ADJ(p) (p)

#define CANCEL_REG_IP 14
