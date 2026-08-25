import type { Metadata } from "next";
import { ProjectDashboard } from "./components/ProjectDashboard";

export const metadata: Metadata = {
  title: "项目总览",
  description: "查看电商项目进度、风险和可追溯资料来源。",
};

export default function Home() {
  return <ProjectDashboard />;
}
