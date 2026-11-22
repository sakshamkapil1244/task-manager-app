# 🚀 Visual Task Manager: Shows Its Work

A full-stack productivity app that doesn't just manage your tasks—it shows you exactly how it processes them in real-time. 

## 🔗 Live Demo
Experience the app here: **[https://task-manager-app-1ro5.onrender.com/](https://task-manager-app-1ro5.onrender.com/)**
*(Note: Since this is hosted on Render's free tier, it may take 30-50 seconds to wake up on the first load. Once loaded, it runs perfectly.)*

## 🧠 The "Show Its Work" Diagram
The standout feature of this app is the live "How it works" diagram. Using **Server-Sent Events (SSE)**, the backend streams real-time updates to the frontend as a task is being processed. 
- **Box 1 (Page):** Lights up when the user submits the form.
- **Box 2 (Server):** Lights up when the Express API receives and validates the request.
- **Box 3 (Database):** Lights up when the task is saved to the SQLite database. 

Each box displays the exact time taken for that step (e.g., `3.49 ms`). If an error occurs, the flow turns red and shows exactly where it failed. A **Replay button** allows you to watch the last execution again at a slower, readable speed.

## ✨ Features
- **Add Tasks:** Simple form to add tasks with titles and deadlines.
- **Real-time Execution Tracking:** Visualizes the full-stack journey of a request.
- **Data Persistence:** Uses `sql.js` (SQLite compiled to WebAssembly) to save data locally without requiring complex C++ build tools.
- **Failure Handling:** Gracefully handles bad inputs or server errors and reflects them in the diagram.
- **Replay Capability:** Re-watch the exact timeline of the last task creation.

## 🛠️ Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Node.js, Express.js
- **Database:** SQLite (via `sql.js`)
- **Real-time Communication:** Server-Sent Events (SSE)
- **Deployment:** Render

## 💻 How to Run Locally
1. Clone the repository:
   ```bash
   git clone https://github.com/Sakshamkapil1244/task-manager-app.git
