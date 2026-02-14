import { useState } from 'react';
import './App.css';

interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
}

function App() {
  const [todoList, setTodoList] = useState<TodoItem[]>([]);
  const [todoItem, setTodoItem] = useState<TodoItem | null>({
    id: '',
    title: '',
    completed: false,
  });

  const handleAddTodo = () => {
    const newTodo: TodoItem = {
      id: crypto.randomUUID(),
      title: todoItem?.title || '',
      completed: false,
    }
    setTodoList([...todoList, newTodo]);
    setTodoItem({ id: '', title: '', completed: false } as TodoItem);
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTodoItem({ ...todoItem, title: e.target.value } as TodoItem);
  }

  return (
    <>
      <h1>Welcome to seam!</h1>
      <p>This is a simple to-do list app to showcase how seam works.</p>
      <input onChange={handleInputChange} value={todoItem?.title} type="text" placeholder="Add a new todo item" />
      <button onClick={handleAddTodo}>Add</button>
      <ul>
        {todoList.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </>
  )
}

export default App
