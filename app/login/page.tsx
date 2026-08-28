import Link from "next/link";
import { Brand } from "@/components/brand";

export default function Login() {
  return <div className="auth-shell"><div className="auth-card glass">
    <div style={{display:"flex",justifyContent:"center"}}><Brand compact/></div>
    <h1 style={{textAlign:"center"}}>Welcome back</h1><p style={{textAlign:"center"}}>Sign in to your account</p>
    <div className="auth-form"><input className="input" placeholder="Email or phone"/><input className="input" type="password" placeholder="Password"/><div style={{textAlign:"right"}}><span className="text-btn">Forgot password?</span></div><Link className="primary-btn" href="/">Sign In</Link></div>
    <div className="auth-divider">or continue with</div>
    <div className="social-auth"><button className="social-btn">● Apple</button><button className="social-btn">G Google</button></div>
    <div style={{textAlign:"center",marginTop:28,fontSize:8,color:"var(--muted)"}}>Don’t have an account? <Link href="/signup" className="teal">Sign up</Link></div>
  </div></div>;
}
