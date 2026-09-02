"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect,useState } from "react";
export function ThemeToggle(){const[d,setD]=useState(false);useEffect(()=>{const v=localStorage.getItem("ws-theme")==="dark";setD(v);document.documentElement.classList.toggle("dark",v)},[]);function toggle(){const n=!d;setD(n);document.documentElement.classList.toggle("dark",n);localStorage.setItem("ws-theme",n?"dark":"light")}return <button onClick={toggle} aria-label="Alternar tema" className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--line)] bg-[var(--panel)] hover:bg-[var(--panel2)]">{d?<Sun size={17}/>:<Moon size={17}/>}</button>}
