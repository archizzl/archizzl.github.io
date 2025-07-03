// this was written in high school
path_length_header = document.getElementById('path_length_header')
path_length_slider = document.getElementById('path_length')
path_length_slider.oninput = function() {
    filled = this.value;
    path_length_header.innerHTML = 'amount of squares that the path will go on for: ' + filled
}
cont = document.getElementById('container')
game_cont = document.getElementById('art_generator_canvas')
titleit = document.getElementById('art_generator_title')
b_num = 0;
scale = 50;
for(i = 0; i<scale; i++){
current_row = document.createElement('div')
current_row.setAttribute('class', 'row')
for(j = 0; j<scale; j++){
    b_num++
    current_box = document.createElement('div')
    current_box.setAttribute('class', 'box')
    current_box.setAttribute('id', 'box_'+b_num)
    if(j==0){
    current_box.setAttribute('data-placement', 'first')
    }
    else if(j==scale){
    current_box.setAttribute('data-placement', 'last')
    }
    current_row.appendChild(current_box)
}
game_cont.appendChild(current_row)
}

filled = 300;
function generate(){
titleit.innerHTML = 'title it!'

clear_path = document.querySelectorAll('.path_div')
for(h = 0; h<clear_path.length; h++){
    clear_path[h].setAttribute('class', 'box')
}


current_point = Math.floor(Math.random()*2495)+1;
for(k = 0; k<filled; k++){
    chosen = false;
    new_path = document.getElementById('box_' + current_point)
    new_path.setAttribute('class', 'path_div');

    while(chosen == false){
    choice = Math.floor(Math.random()*4)

    //down
    if(choice==0){
        if(current_point<((scale*scale)-scale)){
        current_point+=scale;
        chosen = true;
        }
    }
    //right
    else if(choice==1){
        if(new_path.dataset.placement!='last'){
        current_point+=1;
        chosen = true;
        }
    }
    //up
    else if(choice==2){
        if(current_point>=scale){
        current_point-=scale;
        chosen = true;
        }
    }
    //left
    else if(choice==3){
        if(new_path.dataset.placement!='first'){
        current_point-=1;
        chosen = true;
        }
    }

    }
}
}
generate()
