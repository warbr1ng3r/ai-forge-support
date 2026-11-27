type CatalogLicenseFields = { name: string; parameters: Record<string, string[]> };

function singleField(parameters: CatalogLicenseFields["parameters"], name: string) {
  const values = parameters[name];
  return values?.length === 1 ? values[0] : undefined;
}

function deliveryKind(text: string | undefined) {
  if (/^электронн/iu.test(text?.trim() ?? "")) return "electronic";
  if (/^физическ/iu.test(text?.trim() ?? "")) return "physical";
}

export function conflictingLicenseFields({ name, parameters }: CatalogLicenseFields) {
  const annual = name.match(/(?<!\p{L})годов(?:ая|ой|ую)\s+лицензи\p{L}*/iu)?.[0];
  const perpetual = name.match(/(?<!\p{L})бессрочн(?:ая|ой|ую)\s+лицензи\p{L}*/iu)?.[0];
  const field = singleField(parameters, "Срок действия");
  const term = field && annual && !perpetual && /бессрочн/iu.test(field) ? { title: annual, field }
    : field && perpetual && !annual && /^\s*(?:\d+\s*(?:мес|год|лет)|год\p{L}*|срочн\p{L}*)/iu.test(field) ? { title: perpetual, field }
    : undefined;

  const method = singleField(parameters, "Способ доставки");
  const type = singleField(parameters, "Тип поставки");
  const methodKind = deliveryKind(method);
  const typeKind = deliveryKind(type);
  const delivery = method && type && methodKind && typeKind && methodKind !== typeKind ? { method, type } : undefined;
  return { term, delivery };
}
