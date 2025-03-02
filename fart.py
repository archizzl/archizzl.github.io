import os

def create_directory(directory, caption):
    with open(os.path.join(directory, 'index.html'), 'w') as f:
        f.write('''<html>
  <head>
    <style>
      * {
        margin: 5px;
        padding: 0;
        color: green;
      }
      h3 {
        text-decoration: underline;
      }
      #ventana {
        height: 70vh;
        width: 70vw;
      }
      fieldset {
        border: none;
        outline: none;
        display: flex;
        flex-flow: row wrap;
        width: 60vw;
      }
      a {
        border-radius: 5px;
        padding: 5px;
        background-color: #efefef;
        border: 1px solid black;
        transition: 0.05s;
      }
      a:hover {
        transform: scale(1.1);
        opacity: 0.5;
      }
    </style>
  </head>
  <body>
    <h3>''' + 
      caption + '''
    </h3>
    <fieldset>''')
        for filename in sorted(os.listdir(directory)):
            if filename.endswith('.html') and filename != "index.html":
                f.write(f'<a href="{filename}" id="{filename[:-5]}" target="ventana">{filename[:-5].replace("_", " ")}</a>')
        f.write('''</fieldset>
    <iframe name='ventana' id="ventana" src='../words/horses.txt'></iframe>
  
  </body>
  <script>
    current_source = 0;
    console.log("wghat the fuck")
    function changeSrc(loc) {
        console.log("banana")
        console.log(loc)
        if(current_source) {
                console.log("there is a current source")
            document.getElementById(current_source).style.border = "1px solid black";
        }
        document.getElementById('ventana').src = loc;
        current_source = loc;
        console.log(document.getElementById(loc))
        document.getElementById(loc).style.border = "3px solid black";
    }
  </script>
</html>
''')
    print('index.html generated.')

create_directory('./projects', 'tiny, noncommital tricks & treats i built in high school and college')