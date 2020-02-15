#Author:Sun Yan
#Function: convert html to md

import html2text as ht  # pip install html2text
import os 
text_maker = ht.HTML2Text()
#text_maker.ignore_links = True
text_maker.bypass_tables = False
path ="/Users/robbin/code/old_blog/2013/08/09/2013-08-09-84467/index.html"
htmlfile = open(path,'r',encoding='UTF-8')
htmlpage = htmlfile.read()
text = text_maker.handle(htmlpage)
md = text.split('#')  # split post content
open("1.md","w").write(md[1])  # write file as a md file
