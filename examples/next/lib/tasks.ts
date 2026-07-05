// A tiny in-memory "tasks" store shared across the API routes. This is a demo —
// state is per-server-process and resets on restart. No database required.

export interface Task {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
}

const tasks: Task[] = [
  { id: 1, title: 'Take the dog out', done: true, createdAt: new Date().toISOString() },
  { id: 2, title: 'Ship NextDog', done: false, createdAt: new Date().toISOString() },
];

let nextId = tasks.length + 1;

export function listTasks(): Task[] {
  return tasks;
}

export function getTask(id: number): Task | undefined {
  return tasks.find((task) => task.id === id);
}

export function createTask(title: string): Task {
  const task: Task = {
    id: nextId++,
    title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  return task;
}
