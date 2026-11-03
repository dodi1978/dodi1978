# ClassChat

A live chat for the classroom. Students join from their phone or laptop with a short code, and the chat can **float on top of your PowerPoint slideshow** so you never have to leave your slides.

It runs in any web browser, so it doesn't need to plug into your employer's systems. Students don't need accounts or apps.

## What it does

**Students** go to the website, type the 5-letter code (or scan the QR code), pick a name and chat. They can like messages, reply to a message, and delete their own messages.

**You (the teacher)** get:

- a big code and QR code, plus a **full-screen join screen** to show on the projector
- **Float chat over my slides**: a small window that stays on top of PowerPoint, even in a full-screen slideshow (Chrome or Edge, see below). You can read and reply from it.
- **Pin** a message so it stays at the top for everyone
- **Most liked first**: sort the chat so the questions the class cares most about rise to the top
- **Pause the chat**: students can read but not post
- **Hide student names from classmates**: encourages shy students. You still see who wrote what.
- delete any message, clear the chat, **download the chat** as a text file, and end the session

## Using it over PowerPoint

1. Open the teacher page in **Google Chrome** or **Microsoft Edge** and start a session.
2. Show the join screen, let students join, then start your slideshow.
3. Before the slideshow, or by switching to the browser for a moment (Alt+Tab), click **Float chat over my slides**.
4. A small chat window appears. Drag it to a corner and resize it. It stays on top of the slideshow.
5. Close the small window to put the chat back on the teacher page.

Try it once before class. If you use two screens (projector + laptop), you can put the floating window on your laptop screen only, so students see your slides and you see the chat. To share the chat with the class, put it on the projector screen.

Other browsers (Firefox, Safari) can't keep a window on top. There, the button opens a small separate window you can place beside your slides.

## Privacy

- **No AI, no outside services.** ClassChat contains no AI and doesn't call any API (Claude, OpenAI or any other). The server uses only Node.js's built-in parts and has no add-on packages. The pages load nothing from other websites, and the QR code is created on the device. Nothing typed in the chat is sent anywhere that could use it to train AI.
- **Hosting:** the app runs on Render, a normal hosting company, not an AI service. Its data processing agreement covers how it handles data on its servers.
- **Students' devices:** some phone keyboards or browser assistants have their own AI features that read what you type. That's a setting on the student's device and outside the app's control.
- Messages are kept **only in the server's memory**. Nothing is saved to disk.
- **Ending the session** deletes everything. Sessions nobody uses for 12 hours are deleted automatically. A server restart also deletes everything.
- Students choose their own display name (a nickname is fine). No email or login.
- Remind students not to share personal information in the chat. If needed, check your institution's guidance on online tools.

## Run it on your own computer

You need [Node.js](https://nodejs.org) version 20 or newer.

```bash
cd classchat
npm start
```

Open http://localhost:3000/teacher. To test as a student, open http://localhost:3000 in a second browser window. Students in a real classroom can't reach your computer, so for class you need to put it online. See [DEPLOY.md](DEPLOY.md).

## Settings

| Environment variable | What it does |
|---|---|
| `CLASSCHAT_TEACHER_CODE` | Private code needed to *start* a session. Set this when it's online so only you can start sessions. |
| `PORT` | Port to listen on (hosts like Render set this for you). |

## For developers

- `server.js`: plain Node.js with no dependencies. It handles the API and live updates (Server-Sent Events).
- `public/chat.js`: the chat panel used by both the student and teacher pages.
- `public/teacher.html`: the teacher dashboard, including the floating window (Document Picture-in-Picture API).
- `public/room.html`: the student page. `public/index.html`: enter a code.
- `public/vendor/qrcode.js`: QR code generator (MIT licence, Kazuhiko Arase).
- Tests: `npm test`
