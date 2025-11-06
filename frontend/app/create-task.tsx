import TaskForm from '@/components/TaskForm';
import { useLocalSearchParams } from 'expo-router';

export default function CreateTaskScreen(){
  const { editId, occDate, projectId } = useLocalSearchParams<{ editId?: string; occDate?: string; projectId?: string }>();
  return <TaskForm mode='full' editId={editId} occDate={occDate} projectId={projectId} />;
}
