# 🥌 Curling Analytics Agent

https://github.com/user-attachments/assets/f0f60232-e7a5-4163-9d12-f7a8d9c9016e

Live at https://cf-ai-chat.michael-xu1816.workers.dev

## Background

I like curling.

Not that many people like curling (including my roommate Hussein 👎).

Luckily, some other people like curling. People like [Jordan Myslik](https://www.jordanmyslik.com/) who once wrote some code to parse curling data from PDFs released by the World Curling Federation (WCF)[^1].

Unfortunately, the WCF changed their data distribution site and Jordan's scraping code no longer works. Thankfully, [Liu Lige](https://github.com/LigeLiu) also likes curling and committed his SQLite DB generated with Jordan's code to GitHub[^2].

Most people who like curling are old. Old people typically don't speak SQL. I am not old, so I built a chatbot for querying the curling DB.

## D1 Database

I spun up a Cloudflare D1 instance and populated it with Lige's DB.

```bash
npx wrangler d1 execute cf-ai-chat-db --remote --file=./data/curling_data.sql
```

See Jordan's [blog](https://www.jordanmyslik.com/portfolio/curling-analytics/) for an excellent description of the DB schema.

## Curling DB Query Tool

Then I asked Cursor to modify the starter template to add a tool for querying the D1 database. It did it no prob.

See [`PROMPTS.md`](PROMPTS.md) for the prompts I used.

## Shot Visualizer

The most interesting part of the curling DB is it contains the position of all stones after every single shot ever played in an international curling competition.

In the PDFs released by the WCF, the stones are visually displayed. Jordan's code does some CV to extract the coordinates of the stones and stores them in the `stone_positions` table.

I wanted to visualize the stones, so I _hand-wrote_ `CurlingHouse.tsx` to be able to display stones.

There's a `Shot ID` input box for selecting a shot to show. This is mainly for testing purposes, as `shot_id` doesn't have meaning outside of `stone_positions`.

## Tying things together: Shot Query Tool

Finally, I asked Cursor to add a tool for querying shot details and displaying them in the curling house.

Now, via the chat interface, you can ask questions about this curling data and the LLM can show you curling house visualizations...

...if it wants to.

> [!WARNING]
> I'm using a model that isn't the most reliable.
> https://github.com/xuchef/cf_ai_curling/blob/935538ad57c8bc220e19315184fc98ec34c6e9d3/src/server.ts#L19

## Running the project

Same as the starter template.

Run locally:

```bash
npm start
```

Deploy:

```bash
npm run deploy
```

[^1]: https://github.com/jwmyslik/curling-analytics?tab=readme-ov-file

[^2]: https://github.com/LigeLiu/Curling-Analytics
