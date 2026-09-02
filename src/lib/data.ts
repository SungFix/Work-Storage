export type VaultItem = { id:string; title:string; type:"Prompt"|"Login"|"Nota"|"Arquivo"; subtitle:string; updated:string; favorite?:boolean };
export const items:VaultItem[]=[
  {id:"1",title:"Prompt — Analista de mercado",type:"Prompt",subtitle:"Pesquisa e síntese de concorrentes",updated:"Hoje, 18:22",favorite:true},
  {id:"2",title:"GitHub pessoal",type:"Login",subtitle:"dev@workstorage.local",updated:"Hoje, 17:40",favorite:true},
  {id:"3",title:"Ideias para automações",type:"Nota",subtitle:"Fluxos, agentes e atalhos úteis",updated:"Ontem, 22:10"},
  {id:"4",title:"Documentação do projeto",type:"Arquivo",subtitle:"work-storage-spec.pdf",updated:"31 ago, 09:18"},
  {id:"5",title:"Prompt — Revisão de código",type:"Prompt",subtitle:"Checklist de segurança e qualidade",updated:"30 ago, 15:31"},
];
