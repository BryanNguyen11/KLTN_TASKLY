import TaskForm from '@/components/TaskForm';
import { useLocalSearchParams } from 'expo-router';

export default function CreateTaskScreen(){
  const { editId, occDate, projectId, refProjectModal } = useLocalSearchParams<{ editId?: string; occDate?: string; projectId?: string; refProjectModal?: string }>();
  return <TaskForm mode='full' editId={editId} occDate={occDate} projectId={projectId} refProjectModal={refProjectModal==='1'} />;
}
