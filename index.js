window.onload = function(){
  let container = document.getElementById('container')
  let words = ['can', 'u', 'dont']
  for(i = 0; i < words.length; i++){
    let curr = document.createElement('div')
    container.appendChild(curr)
    curr.setAttribute('id', words[i])
    let currtwo = document.getElementById(words[i])
    currtwo.innerHTML = words[i]
  }
  i = 0;
  let loop = setInterval(function(){
    if(i<3){
      let curr = document.getElementById(words[i])
      curr.style.color = 'black'
      i++
    }
    else{
      window.clearInterval(loop)
    }
  }, 1000)
  let please = document.getElementById('dont')
  please.style.fontSize = '300px';
  please.style.animation = 'hecc 0.1s linear infinite';
}
