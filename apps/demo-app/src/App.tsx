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
    completed: false
  });
  const handleAddTodo = () => {
    const newTodo: TodoItem = {
      id: crypto.randomUUID(),
      title: todoItem?.title || '',
      completed: false
    };
    setTodoList([...todoList, newTodo]);
    setTodoItem({
      id: '',
      title: '',
      completed: false
    } as TodoItem);
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTodoItem({
      ...todoItem,
      title: e.target.value
    } as TodoItem);
  };
  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTodoList(todoList.map(item => item.id === e.target.id ? {
      ...item,
      completed: e.target.checked
    } : item));
  };
  return <>
      <h1 className="text-4xl font-bold">Welcome to seam!</h1>
      <p className="font-medium">This is a simple to-do list app to showcase how seam works.</p>
      <input className="m-4 w-88 border border-black p-2 rounded-md" onChange={handleInputChange} value={todoItem?.title} type="text" placeholder="Add a new todo item" />
      <button className="w-32 bg-black text-white rounded-md p-2" onClick={handleAddTodo}>Add</button>
      <ul>
        {todoList.map(item => <li className="text-left border border-[1px] border-gray-200 p-2 rounded-md mb-4" key={item.id}>
            <label className="inline-flex items-center">
              <input id={item.id} onChange={handleCheckboxChange} type="checkbox" checked={item.completed} className="mr-2" />
              <span className={item.completed ? 'line-through text-gray-500' : ''}>
                {item.title}
              </span>
            </label>
          </li>)}
      </ul>
    </>;
}
export default App;