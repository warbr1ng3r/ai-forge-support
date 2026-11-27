export function catalogPriceUnit(name: string) {
  if (/количество узлов|по количеству узлов/i.test(name)) return "узел";
  if (/количество почтовых адресов|по количеству почтовых адресов/i.test(name)) return "почтовый адрес";
  if (/по количеству рабочих станций\/файловых серверов/i.test(name)) return "рабочую станцию или файловый сервер";
  if (/\bredcheck\b.*\b1\s+ip[ ‑-]+адрес(?!\p{L})/iu.test(name)) return "IP-адрес";
}
