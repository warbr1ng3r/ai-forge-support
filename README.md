# ИИ агент поддержки

Импорт и поиск по каталогу Softline для чата подбора продуктов.

## Локальный запуск

Нужен Node.js 24.15.0. Скачайте `Mindbox.yml.gz.xml` из [папки материалов](https://drive.google.com/drive/folders/1kxvQQf_vvg7ZsmX9dB6Qot8AM7lHgu2U) и передайте путь при импорте.

```sh
npm ci
npm run catalog:import -- /path/to/catalog.xml
npm run catalog:check
npm run dev
```

База создаётся в `data/t06/catalog.sqlite`.

Интерфейс адаптирован из [официального shadcn/ui Chatbot Template](https://github.com/shadcn-ui/chatbot-template/tree/4106041b1bc9bab44e81ffd2764aa2b6f100e2b0). Лицензия компонентов: [MIT](LICENSE-shadcn-template).
