import { AppShell } from "@/components/navigation";
export function PageShell({children,homeHeader=false}:{children:React.ReactNode;homeHeader?:boolean}) {
  return <AppShell homeHeader={homeHeader}>{children}</AppShell>;
}
