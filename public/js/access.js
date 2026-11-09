(()=>{
 'use strict';
 document.querySelectorAll('input[type="password"]').forEach(input=>{
  const group=document.createElement('div');group.className='input-group password-control';
  input.before(group);group.append(input);
  const button=document.createElement('button');button.type='button';button.className='btn btn-outline-secondary';button.textContent='Göster';button.setAttribute('aria-label','Parolayı göster');button.setAttribute('aria-pressed','false');
  button.addEventListener('click',()=>{const visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'Gizle':'Göster';button.setAttribute('aria-label',visible?'Parolayı gizle':'Parolayı göster');button.setAttribute('aria-pressed',String(visible));});group.append(button);
  const caps=document.createElement('small');caps.className='text-warning-emphasis d-none';caps.textContent='Caps Lock açık.';caps.setAttribute('role','status');group.after(caps);
  input.addEventListener('keyup',event=>caps.classList.toggle('d-none',!event.getModifierState?.('CapsLock')));input.addEventListener('blur',()=>caps.classList.add('d-none'));
 });
})();
