# ИИ агент поддержки

Чат для подбора продуктов из выданного каталога Softline. Поддерживает поиск конкретной лицензии и подбор от задачи клиента.

## Локальный запуск

Нужен Node.js 24.15.0. Скачайте `Mindbox.yml.gz.xml` из [папки материалов](https://drive.google.com/drive/folders/1kxvQQf_vvg7ZsmX9dB6Qot8AM7lHgu2U) и передайте путь при импорте.

```sh
npm ci
npm run catalog:import -- /path/to/catalog.xml
npm run catalog:check
npm run decision:check
npm run chat:check
npm run dev
```

Для чата задайте `POLZA_API_KEY` в локальном `.env.local` по образцу `.env.example`. Откройте [localhost:3000](http://localhost:3000). База создаётся в `data/t06/catalog.sqlite`. Приложение и проверочный скрипт используют этот же файл.

`npm run chat:check` проверяет маршрут чата на загруженном каталоге с тестовыми ответами моделей, без расхода баланса.

DeepSeek ведёт разговор и вызывает поиск по каталогу через Mastra. Перед подтверждением конкретных лицензий инструмент [`verifyFit`](lib/support.ts) отправляет выбранные позиции и условия клиента в [Gemini Decision 1 через Polza SystemOne](lib/decision.ts). Карточки показывают полученную оценку для каждой проверенной позиции. Цены и признаки доступности относятся к снимку каталога. Исходный каталог хранится локально.

Интерфейс адаптирован из [официального shadcn/ui Chatbot Template](https://github.com/shadcn-ui/chatbot-template/tree/4106041b1bc9bab44e81ffd2764aa2b6f100e2b0). Лицензия компонентов: [MIT](LICENSE-shadcn-template).
