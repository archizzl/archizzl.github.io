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
      body {
        display: flex;
        flex-flow: column;
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
      .project_link {
        border-radius: 5px;
        padding: 5px;
        background-color: #efefef;
        border: 1px solid black;
        transition: 0.05s;
      }
      .project_link:hover {
        transform: scale(1.1);
        opacity: 0.5;
      }
      .link {
        width: 130px;
      }
      .black_button {
            text-align: center;
            background-color: black;
            color: white;
            padding: 5px;
            margin: 5px;
            font-size: 15px;
            display: flex;
            justify-content: center;
            align-items: center;
            user-select: none;
      }
  #home_link {
    color: white;
    text-decoration: none;
  }
  .black_button:hover {
    opacity: 0.8;
    cursor: pointer;
  }
    </style>
  </head>
  <body>
    <a id="home_link" href="../index.html"><button class="black_button">home. . .</button></a>

    <h3>''' + 
      caption + '''
    </h3>
    <fieldset>''')
        for filename in sorted(os.listdir(directory)):
            if filename.endswith('.html') and filename != "index.html":
                f.write(f'<a href="{filename}" class="project_link" id="{filename[:-5]}" target="ventana">{filename[:-5].replace("_", " ")}</a>')
        f.write('''</fieldset>
    <iframe name='ventana' id="ventana" src='../words/horses.txt'></iframe>
    <a href="../words/horses.txt" target="_blank" id="link">let's get out of here</a>
  </body>
  <script>
    current_source = 0;
    links = document.querySelectorAll('.project_link');

    links.forEach(link => {
      link.onmousedown = () => {
        loc = link.getAttribute('id');
        console.log('current loc:')
        console.log(current_source)
        console.log('loc selected')
        console.log(loc)
        if(current_source) {
            document.getElementById(current_source).style.outline = "0px";
        }
        current_source = loc;
        document.getElementById(loc).style.outline = "2px solid black";
        console.log('./' + loc + '.html')
        document.getElementById('link').setAttribute('href', './' + loc + '.html')
        console.log(document.getElementById("link").getAttribute('href'))
      }
    })
  </script>
</html>
''')
    print('index.html generated.')

create_directory('./projects', 'tiny, noncommital tricks & treats i built in high school and college')