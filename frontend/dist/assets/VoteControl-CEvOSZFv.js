import{i as l,c as b,r as j,j as r}from"./index-CXXw5Qh0.js";/**
 * @license lucide-react v0.414.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=l("ArrowBigDown",[["path",{d:"M15 6v6h4l-7 7-7-7h4V6h6z",key:"1thax2"}]]);/**
 * @license lucide-react v0.414.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=l("ArrowBigUp",[["path",{d:"M9 18v-6H5l7-7 7 7h-4v6H9z",key:"1x06kx"}]]),C=e=>e==null?"–":Math.abs(e)<1e3?String(e):`${(e/1e3).toFixed(e%1e3===0?0:1)}k`,A=({post:e,orientation:d="vertical",size:u="md"})=>{const{vote:x,viewOf:v,votingEnabled:h,allowDownvotes:m}=b(),w=j.useId(),p=e.id||e._id,{value:t,score:n}=v(e),i=e.scoreHidden;if(!h)return null;const f=u==="sm"?"h-4 w-4":"h-5 w-5",g=d==="vertical"?"flex-col gap-0.5":"flex-row items-center gap-1",a=o=>{const s=t===o,y=o===1?$:k,c=o===1?"Upvote":"Downvote";return r.jsx("button",{type:"button",onClick:()=>x(p,o,t,n),"aria-pressed":s,"aria-label":s?`Remove ${c.toLowerCase()}`:c,className:`cursor-pointer rounded p-1 transition-colors ${s?o===1?"text-crimson":"text-sky-400":"text-silver-muted hover:bg-night-raised hover:text-silver"}`,children:r.jsx(y,{className:f,"aria-hidden":"true",fill:s?"currentColor":"none"})})};return r.jsxs("div",{className:`flex ${g}`,children:[a(1),r.jsx("span",{className:`min-w-[2ch] text-center text-xs font-semibold tabular-nums ${t===1?"text-crimson":t===-1?"text-sky-400":"text-silver"}`,"aria-hidden":"true",children:i?"–":C(n)}),r.jsx("span",{id:w,role:"status","aria-live":"polite",className:"sr-only",children:i?"Score hidden while this post is new":`Score ${n}${t===1?", you upvoted":t===-1?", you downvoted":""}`}),m&&a(-1)]})};export{A as V};
