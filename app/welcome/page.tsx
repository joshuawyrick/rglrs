import Link from "next/link";
import { BrandMark } from "@/components/brand";
export default function Welcome(){return <div className="splash-shell"><BrandMark size={118}/><h1>RGLRS</h1><p>Private social for<br/>the people who matter.</p><Link href="/login" className="primary-btn" style={{marginTop:28,minWidth:170}}>Get Started</Link></div>}
