import Workspace from '@/components/workspace';
export default async function Home({searchParams}:{searchParams:Promise<{view?:string}>}){
  const {view}=await searchParams;
  return <Workspace initialView={view}/>;
}
